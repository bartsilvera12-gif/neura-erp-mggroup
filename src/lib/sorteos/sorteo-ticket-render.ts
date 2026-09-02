import "server-only";

import { createHash } from "node:crypto";
import {
  mergeCustomTemplateFields,
  type SorteoTicketImageConfig,
} from "@/lib/sorteos/sorteo-ticket-types";
import { measureTicketTextWidth, svgTextAsPath } from "@/lib/sorteos/sorteo-ticket-text-path";
import {
  buildSorteoTicketQrPayload,
  renderSorteoTicketQrDataUrl,
} from "@/lib/sorteos/sorteo-ticket-qr";

export type SorteoTicketRenderInput = {
  empresaNombre: string;
  sorteoNombre: string;
  clienteNombre?: string;
  documento?: string;
  telefono?: string;
  numeroOrden: string;
  cupones: string[];
  /** ISO o texto localizable */
  fechaHora: string;
  config: SorteoTicketImageConfig;
  /** bytes PNG/JPEG/WebP o null */
  logoBytes: Buffer | null;
  logoMime: string | null;
  backgroundBytes: Buffer | null;
  backgroundMime: string | null;
  /** Plantilla completa (custom_template) */
  templateBytes?: Buffer | null;
  templateMime?: string | null;
  /**
   * QR ya renderizado como data URL PNG. Lo resuelve `renderTicketPngUnified`
   * (los builders de SVG son sincrónicos y el QR se genera de forma asíncrona).
   */
  qrDataUrl?: string | null;
};

/** Canvas modo automático — comprobante vertical premium */
const WA = 1080;
const HA = 1350;
const PAD = 48;
const CARD_RX = 28;

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0]!.slice(0, 2).toUpperCase();
  return (p[0]![0]! + p[p.length - 1]![0]!).toUpperCase();
}

function dataUrlFromBuffer(buf: Buffer, mime: string): string {
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

/** Trunca con «…» para que un valor largo no se salga de su columna. */
function truncateToWidth(text: string, fontSize: number, weight: number, maxWidth: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (measureTicketTextWidth(t, fontSize, weight) <= maxWidth) return t;
  let lo = 1;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureTicketTextWidth(`${t.slice(0, mid).trim()}…`, fontSize, weight) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${t.slice(0, lo).trim()}…`;
}

/** Parte el texto en líneas por palabra; la última se trunca si no entra. */
function wrapToWidth(
  text: string,
  fontSize: number,
  weight: number,
  maxWidth: number,
  maxLines: number
): string[] {
  const palabras = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (palabras.length === 0) return [];
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of palabras) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra;
    if (measureTicketTextWidth(tentativa, fontSize, weight) <= maxWidth) {
      actual = tentativa;
      continue;
    }
    if (actual) lineas.push(actual);
    actual = palabra;
    if (lineas.length === maxLines - 1) break;
  }
  const restante = palabras.slice(lineas.join(" ").split(" ").filter(Boolean).length).join(" ");
  lineas.push(truncateToWidth(restante || actual, fontSize, weight, maxWidth));
  return lineas.slice(0, maxLines);
}

/** Números de cupón dentro del talón, adaptados a cuántos son y al espacio disponible. */
function cuponesStubSvg(opts: {
  cupones: string[];
  cx: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  color: string;
  accent: string;
}): { svg: string; height: number } {
  const { cupones, cx, top, maxWidth, maxHeight, color, accent } = opts;
  if (cupones.length === 0) return { svg: "", height: 0 };
  const pieces: string[] = [];

  if (cupones.length <= 4) {
    let fs = 76;
    while (fs > 28 && (cupones.length * fs * 1.24 > maxHeight || anyTooWide(cupones, fs, 800, maxWidth))) {
      fs -= 4;
    }
    const lineH = fs * 1.24;
    let y = top;
    for (const c of cupones) {
      y += fs;
      pieces.push(
        svgTextAsPath({ text: c, x: cx, y, fontSize: fs, weight: 800, fill: color, textAnchor: "middle" })
      );
      y += lineH - fs;
    }
    return { svg: pieces.filter(Boolean).join("\n"), height: cupones.length * lineH };
  }

  const MAX_SHOW = 21;
  const list = cupones.slice(0, MAX_SHOW);
  const cols = cupones.length <= 8 ? 2 : 3;
  const filas = Math.ceil(list.length / cols);
  const hayResto = cupones.length > MAX_SHOW;
  const restoH = hayResto ? 30 : 0;
  let fs = 34;
  while (fs > 15 && filas * fs * 1.5 + restoH > maxHeight) fs -= 2;
  const rowH = fs * 1.5;
  const cellW = maxWidth / cols;
  const x0 = cx - maxWidth / 2 + cellW / 2;
  const alto = filas * rowH + restoH;
  const top0 = top;
  list.forEach((c, i) => {
    pieces.push(
      svgTextAsPath({
        text: c,
        x: x0 + (i % cols) * cellW,
        y: top0 + fs + Math.floor(i / cols) * rowH,
        fontSize: fs,
        weight: 700,
        fill: color,
        textAnchor: "middle",
      })
    );
  });
  if (hayResto) {
    pieces.push(
      svgTextAsPath({
        text: `y ${cupones.length - MAX_SHOW} más`,
        x: cx,
        y: top0 + filas * rowH + 22,
        fontSize: 19,
        weight: 600,
        fill: accent,
        textAnchor: "middle",
      })
    );
  }
  return { svg: pieces.filter(Boolean).join("\n"), height: alto };
}

function anyTooWide(items: string[], fontSize: number, weight: number, maxWidth: number): boolean {
  return items.some((t) => measureTicketTextWidth(t, fontSize, weight) > maxWidth);
}

/**
 * Modo automático: boleta con troquel.
 *
 * Cabecera oscura con el logo, nombre del sorteo, tarjeta de datos, línea de corte
 * con muescas y un talón oscuro donde el cupón y el QR son los protagonistas.
 * Todo se ubica con medidas reales de texto, no con offsets fijos.
 */
export function buildSorteoTicketSvg(input: SorteoTicketRenderInput): string {
  const cfg = input.config;
  const bg = (cfg.backgroundColor ?? "#eef1f5").trim();
  const primary = (cfg.primaryColor ?? "#0d1424").trim();
  const secondary = (cfg.secondaryColor ?? "#6b7787").trim();
  const accent = (cfg.primaryColor ? (cfg.secondaryColor ?? "#d4a017") : "#d4a017").trim();
  const title = (cfg.title ?? "Comprobante de participación").trim();
  const footer = (cfg.legalFooter ?? "").trim();

  const showLogo = cfg.showLogo !== false;
  const showNombre = cfg.showClienteNombre !== false;
  const showDoc = cfg.showDocumento !== false;
  const showTel = cfg.showTelefono !== false;
  const showOrd = cfg.showNumeroOrden !== false;
  const showCup = cfg.showCupones !== false;
  const showSorteoNom = cfg.showSorteoNombre !== false;

  const hasLogo = showLogo && Boolean(input.logoBytes && input.logoMime);
  const cx = WA / 2;
  const innerW = WA - PAD * 2;
  const parts: string[] = [`<rect width="${WA}" height="${HA}" fill="${bg}"/>`];

  if (input.backgroundBytes && input.backgroundMime) {
    const href = dataUrlFromBuffer(input.backgroundBytes, input.backgroundMime);
    parts.push(
      `<image href="${href}" x="0" y="0" width="${WA}" height="${HA}" preserveAspectRatio="xMidYMid slice" opacity="0.08"/>`
    );
  }

  // ---------- Cabecera ----------
  const LOGO = 200;
  const bandH = hasLogo ? 356 : 262;
  parts.push(`<rect x="0" y="0" width="${WA}" height="${bandH}" fill="${primary}"/>`);
  parts.push(`<rect x="0" y="${bandH - 5}" width="${WA}" height="5" fill="${accent}"/>`);

  let y = 46;
  if (hasLogo) {
    const href = dataUrlFromBuffer(input.logoBytes!, input.logoMime!);
    parts.push(
      `<image href="${href}" x="${cx - LOGO / 2}" y="${y}" width="${LOGO}" height="${LOGO}" preserveAspectRatio="xMidYMid meet"/>`
    );
    y += LOGO + 26;
  } else if (showLogo) {
    const r = 54;
    parts.push(`<circle cx="${cx}" cy="${y + r}" r="${r}" fill="#ffffff" opacity="0.10"/>`);
    parts.push(
      svgTextAsPath({
        text: initials(input.empresaNombre),
        x: cx,
        y: y + r + 17,
        fontSize: 46,
        weight: 800,
        fill: "#ffffff",
        textAnchor: "middle",
      })
    );
    y += r * 2 + 24;
  }
  parts.push(
    svgTextAsPath({
      text: truncateToWidth(input.empresaNombre.toUpperCase(), 30, 800, innerW),
      x: cx,
      y: y + 30,
      fontSize: 30,
      weight: 800,
      fill: "#ffffff",
      textAnchor: "middle",
    }),
    svgTextAsPath({
      text: truncateToWidth(title.toUpperCase(), 19, 600, innerW),
      x: cx,
      y: y + 30 + 34,
      fontSize: 19,
      weight: 600,
      fill: accent,
      textAnchor: "middle",
    })
  );

  // ---------- Nombre del sorteo ----------
  let cursor = bandH + 46;
  if (showSorteoNom && input.sorteoNombre?.trim()) {
    const lineas = wrapToWidth(input.sorteoNombre.trim(), 32, 800, innerW, 2);
    for (const linea of lineas) {
      parts.push(
        svgTextAsPath({
          text: linea,
          x: cx,
          y: cursor + 32,
          fontSize: 32,
          weight: 800,
          fill: primary,
          textAnchor: "middle",
        })
      );
      cursor += 40;
    }
    cursor += 18;
  }

  // ---------- Tarjeta de datos (dos columnas) ----------
  const celdas: { label: string; value: string }[] = [];
  if (showNombre && input.clienteNombre?.trim()) {
    celdas.push({ label: "Participante", value: input.clienteNombre.trim() });
  }
  if (showOrd && String(input.numeroOrden ?? "").trim()) {
    celdas.push({ label: "Nº de orden", value: String(input.numeroOrden).trim() });
  }
  if (showDoc && input.documento?.trim()) celdas.push({ label: "Documento", value: input.documento.trim() });
  if (showTel && input.telefono?.trim()) celdas.push({ label: "Teléfono", value: input.telefono.trim() });

  const CARD_PAD = 34;
  const LABEL_FS = 18;
  const VALUE_FS = 28;
  const CELL_H = 78;
  const filasCard = Math.ceil(celdas.length / 2);
  const cardTop = cursor;
  const cardH = filasCard > 0 ? CARD_PAD * 2 + filasCard * CELL_H - 16 : 0;
  const colW = (innerW - CARD_PAD * 2) / 2 - 14;

  if (filasCard > 0) {
    parts.push(
      `<rect x="${PAD}" y="${cardTop}" width="${innerW}" height="${cardH}" rx="${CARD_RX}" fill="#ffffff" filter="url(#cardShadow)"/>`
    );
    celdas.forEach((celda, i) => {
      const col = i % 2;
      const fila = Math.floor(i / 2);
      const x = PAD + CARD_PAD + col * ((innerW - CARD_PAD * 2) / 2 + 14);
      const yTop = cardTop + CARD_PAD + fila * CELL_H;
      parts.push(
        svgTextAsPath({
          text: celda.label.toUpperCase(),
          x,
          y: yTop + LABEL_FS,
          fontSize: LABEL_FS,
          weight: 600,
          fill: secondary,
          textAnchor: "start",
        }),
        svgTextAsPath({
          text: truncateToWidth(celda.value, VALUE_FS, 700, colW),
          x,
          y: yTop + LABEL_FS + 14 + VALUE_FS,
          fontSize: VALUE_FS,
          weight: 700,
          fill: primary,
          textAnchor: "start",
        })
      );
    });
  }

  // ---------- Pie ----------
  const footerBaseline = HA - PAD + 6;
  const fechaBaseline = footer ? footerBaseline - 30 : footerBaseline;

  // ---------- Línea de corte y talón ----------
  const cutY = cardTop + cardH + 42;
  parts.push(
    `<circle cx="0" cy="${cutY}" r="26" fill="${bg}"/>`,
    `<circle cx="${WA}" cy="${cutY}" r="26" fill="${bg}"/>`,
    `<line x1="${PAD - 6}" y1="${cutY}" x2="${WA - PAD + 6}" y2="${cutY}" stroke="${secondary}" stroke-width="3" stroke-dasharray="16 14" opacity="0.55"/>`
  );

  const stubTop = cutY + 40;
  const stubBottom = fechaBaseline - 44;
  const stubH = Math.max(230, stubBottom - stubTop);
  parts.push(
    `<rect x="${PAD}" y="${stubTop}" width="${innerW}" height="${stubH}" rx="${CARD_RX}" fill="${primary}"/>`
  );

  const QR = Math.min(214, stubH - 56);
  const hayQr = Boolean(input.qrDataUrl);
  const stubPad = 34;
  const qrX = PAD + innerW - stubPad - QR;
  const qrY = stubTop + (stubH - QR) / 2;
  if (hayQr) {
    parts.push(
      `<rect x="${qrX - 10}" y="${qrY - 10}" width="${QR + 20}" height="${QR + 20}" rx="14" fill="#ffffff"/>`,
      `<image href="${input.qrDataUrl}" x="${qrX}" y="${qrY}" width="${QR}" height="${QR}"/>`
    );
  }

  const cupones = showCup ? input.cupones.map((c) => String(c).trim()).filter(Boolean) : [];
  const zonaX = PAD + stubPad;
  const zonaW = (hayQr ? qrX - 22 : PAD + innerW - stubPad) - zonaX;
  const zonaCx = zonaX + zonaW / 2;
  const LABEL_STUB = 19;
  const LABEL_GAP = 18;
  const zonaAlto = stubH - 52;
  /** Rótulo y números son un solo bloque centrado: si no, el rótulo queda flotando arriba. */
  const medido = cuponesStubSvg({
    cupones,
    cx: zonaCx,
    top: 0,
    maxWidth: zonaW,
    maxHeight: zonaAlto - (LABEL_STUB + LABEL_GAP),
    color: "#ffffff",
    accent,
  });
  const grupoAlto = cupones.length > 0 ? LABEL_STUB + LABEL_GAP + medido.height : 0;
  const grupoTop = stubTop + Math.max(26, (stubH - grupoAlto) / 2);
  if (cupones.length > 0) {
    parts.push(
      svgTextAsPath({
        text: cupones.length === 1 ? "TU CUPÓN" : "TUS CUPONES",
        x: zonaCx,
        y: grupoTop + LABEL_STUB,
        fontSize: LABEL_STUB,
        weight: 700,
        fill: accent,
        textAnchor: "middle",
      }),
      cuponesStubSvg({
        cupones,
        cx: zonaCx,
        top: grupoTop + LABEL_STUB + LABEL_GAP,
        maxWidth: zonaW,
        maxHeight: zonaAlto - (LABEL_STUB + LABEL_GAP),
        color: "#ffffff",
        accent,
      }).svg
    );
  }

  // ---------- Fecha y nota legal ----------
  parts.push(
    svgTextAsPath({
      text: input.fechaHora,
      x: cx,
      y: fechaBaseline,
      fontSize: 21,
      weight: 400,
      fill: secondary,
      textAnchor: "middle",
    })
  );
  if (footer) {
    parts.push(
      svgTextAsPath({
        text: truncateToWidth(footer, 18, 400, innerW),
        x: cx,
        y: footerBaseline,
        fontSize: 18,
        weight: 400,
        fill: secondary,
        textAnchor: "middle",
      })
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WA}" height="${HA}" viewBox="0 0 ${WA} ${HA}">
  <defs>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-opacity="0.10"/>
    </filter>
  </defs>
  ${parts.filter(Boolean).join("\n  ")}
</svg>`;
}

function fillAttr(color: string): string {
  const t = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t) || /^#[0-9A-Fa-f]{3}$/.test(t)) return t;
  return "#111827";
}

/**
 * Plantilla personalizada: datos del cliente bajo el logo y centrados como el cupón; tamaño del cupón sin tocar.
 * Colores desde mergeCustomTemplateFields. 1–6 cupones: centrados; más de 6: grilla.
 */
function buildCustomTemplateOverlaySvg(
  w: number,
  h: number,
  input: SorteoTicketRenderInput,
  layout: ReturnType<typeof mergeCustomTemplateFields>
): string {
  const padX = Math.max(40, Math.min(layout.cliente_nombre?.x ?? 72, w * 0.2));
  const bottomPad = Math.max(36, Math.round(h * 0.028));
  /**
   * Inicio del bloque de datos (coord. Y antes del primer baseline).
   * El logo va **dentro del PNG**: sin segmentación no hay bbox; un ratio bajo
   * solapa el texto con el arte. ~39% del alto suele quedar debajo de logos grandes tipo story.
   */
  const metaTop = Math.round(h * 0.39);

  const colName = fillAttr(layout.cliente_nombre.color);
  const colDoc = fillAttr(layout.cliente_documento.color);
  const colTel = fillAttr(layout.telefono.color);
  const colOrd = fillAttr(layout.numero_orden.color);
  const colSort = fillAttr(layout.sorteo_nombre.color);
  const colCup = fillAttr(layout.cupones.color);

  const cupones = input.cupones ?? [];
  const metaGap = 14;
  const blockGap = 22;

  type MetaRow = { text: string; fs: number; color: string; weight: number };
  const buildMetaRows = (metaScale: number): MetaRow[] => {
    const r = (n: number) => Math.max(16, Math.round(n * metaScale));
    const rows: MetaRow[] = [];
    const cn = input.clienteNombre?.trim();
    if (cn) {
      rows.push({
        text: cn,
        fs: r(Math.max(layout.cliente_nombre.fontSize, 34)),
        color: colName,
        weight: 700,
      });
    }
    const doc = input.documento?.trim();
    if (doc) {
      rows.push({
        text: `Documento: ${doc}`,
        fs: r(Math.max(layout.cliente_documento.fontSize, 28)),
        color: colDoc,
        weight: 600,
      });
    }
    const tel = input.telefono?.trim();
    if (tel) {
      rows.push({
        text: `Teléfono: ${tel}`,
        fs: r(Math.max(layout.telefono.fontSize, 28)),
        color: colTel,
        weight: 600,
      });
    }
    const ord = String(input.numeroOrden ?? "").trim();
    if (ord) {
      rows.push({
        text: `Nº orden: ${ord}`,
        fs: r(Math.max(layout.numero_orden.fontSize, 34)),
        color: colOrd,
        weight: 700,
      });
    }
    const sn = input.sorteoNombre?.trim();
    if (sn) {
      rows.push({
        text: `Sorteo: ${sn}`,
        fs: r(Math.max(layout.sorteo_nombre.fontSize, 28)),
        color: colSort,
        weight: 600,
      });
    }
    return rows;
  };

  /** Altura del layout de cupones (el tamaño del número **no** usa metaScale). */
  const simulateLastCupBaseline = (yAfterMeta: number): number => {
    let y = yAfterMeta;
    if (cupones.length === 0) return y;
    if (cupones.length <= 6) {
      const fs = Math.min(
        84,
        Math.max(52, Math.round(layout.cupones.fontSize + (6 - Math.min(cupones.length, 6)) * 3))
      );
      const step = Math.round(fs * 1.2);
      for (let i = 0; i < cupones.length; i++) {
        y += step;
      }
      return y;
    }
    const cols = 3;
    const fs = 22;
    const rowH = 34;
    const maxShow = 24;
    const list = cupones.slice(0, maxShow);
    const gy = y + fs + 4;
    let maxY = gy;
    for (let i = 0; i < list.length; i++) {
      const row = Math.floor(i / cols);
      const yCell = gy + row * rowH;
      if (yCell > maxY) maxY = yCell;
    }
    if (cupones.length > maxShow) {
      maxY += Math.ceil(list.length / cols) * rowH + 8;
      maxY += 22;
    }
    return maxY;
  };

  /** El QR va al pie; se reserva su alto para que el texto se achique en vez de solaparlo. */
  const qrSize = input.qrDataUrl ? Math.max(160, Math.min(320, Math.round(Math.min(w, h) * 0.2))) : 0;
  const qrReserve = qrSize > 0 ? qrSize + 24 : 0;

  let metaScale = 1.06;
  let metaRows = buildMetaRows(metaScale);
  for (let iter = 0; iter < 22; iter++) {
    metaRows = buildMetaRows(metaScale);
    let ySim = metaTop;
    for (const row of metaRows) {
      ySim += row.fs + metaGap;
    }
    ySim += blockGap - metaGap;
    const lastY = simulateLastCupBaseline(ySim);
    if (lastY <= h - bottomPad - qrReserve || metaScale <= 0.56) {
      break;
    }
    metaScale *= 0.93;
  }

  const cx = w / 2;
  const pieces: string[] = [];
  let y = metaTop;
  for (const row of metaRows) {
    y += row.fs;
    pieces.push(
      svgTextAsPath({
        text: row.text,
        x: cx,
        y,
        fontSize: row.fs,
        weight: row.weight,
        fill: fillAttr(row.color),
        textAnchor: "middle",
      })
    );
    y += metaGap;
  }
  y += blockGap - metaGap;

  if (cupones.length === 0) {
    /* Sin cupones resueltos: no dibujar placeholder */
  } else if (cupones.length <= 6) {
    const fs = Math.min(
      84,
      Math.max(52, Math.round(layout.cupones.fontSize + (6 - Math.min(cupones.length, 6)) * 3))
    );
    const step = Math.round(fs * 1.2);
    for (let i = 0; i < cupones.length; i++) {
      y += step;
      pieces.push(
        svgTextAsPath({
          text: cupones[i]!,
          x: cx,
          y,
          fontSize: fs,
          weight: 800,
          fill: colCup,
          textAnchor: "middle",
        })
      );
    }
  } else {
    const cols = 3;
    const cellW = (w - 2 * padX) / cols;
    const fs = 22;
    const rowH = 34;
    const maxShow = 24;
    const list = cupones.slice(0, maxShow);
    let gy = y + fs + 4;
    for (let i = 0; i < list.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const xCell = padX + col * cellW + cellW / 2;
      const yCell = gy + row * rowH;
      pieces.push(
        svgTextAsPath({
          text: list[i]!,
          x: xCell,
          y: yCell,
          fontSize: fs,
          weight: 700,
          fill: colCup,
          textAnchor: "middle",
        })
      );
    }
    if (cupones.length > maxShow) {
      gy += Math.ceil(list.length / cols) * rowH + 8;
      pieces.push(
        svgTextAsPath({
          text: `+${cupones.length - maxShow} más`,
          x: cx,
          y: gy,
          fontSize: 18,
          weight: 600,
          fill: colCup,
          textAnchor: "middle",
        })
      );
    }
  }

  if (input.qrDataUrl && qrSize > 0) {
    /** Recuadro blanco detrás: la plantilla del cliente suele ser oscura y el lector falla. */
    const qrX = Math.round((w - qrSize) / 2);
    const qrY = Math.round(h - bottomPad - qrSize);
    const padBox = Math.round(qrSize * 0.05);
    pieces.push(
      `<rect x="${qrX - padBox}" y="${qrY - padBox}" width="${qrSize + padBox * 2}" height="${
        qrSize + padBox * 2
      }" rx="${Math.round(qrSize * 0.06)}" fill="#ffffff"/>`,
      `<image href="${input.qrDataUrl}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}"/>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${pieces.filter(Boolean).join("\n")}
</svg>`;
}

async function renderCustomTemplateTicketPng(input: SorteoTicketRenderInput): Promise<Buffer> {
  const buf = input.templateBytes!;
  const sharpMod = (await import("sharp")).default;
  const meta = await sharpMod(buf).metadata();
  const w = meta.width && meta.width > 0 ? meta.width : input.config.custom_template_width ?? 1080;
  const h = meta.height && meta.height > 0 ? meta.height : input.config.custom_template_height ?? 1350;

  const fields = mergeCustomTemplateFields(input.config);
  const overlaySvg = buildCustomTemplateOverlaySvg(w, h, input, fields);
  const overlayPng = await sharpMod(Buffer.from(overlaySvg, "utf8")).png().toBuffer();

  const baseRgb = await sharpMod(buf)
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();

  return sharpMod(baseRgb)
    .composite([{ input: overlayPng, left: 0, top: 0, blend: "over" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function renderSorteoTicketPng(svg: string): Promise<{ png: Buffer; hash: string }> {
  const sharpMod = (await import("sharp")).default;
  const png = await sharpMod(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer();
  const hash = createHash("sha256").update(png).digest("hex");
  return { png, hash };
}

/**
 * Punto único: plantilla personalizada (imagen + texto) o automático (SVG premium).
 */
export async function renderTicketPngUnified(input: SorteoTicketRenderInput): Promise<{ png: Buffer; hash: string }> {
  /** El QR se resuelve una sola vez acá y lo consumen los dos modos de render. */
  const withQr: SorteoTicketRenderInput = {
    ...input,
    qrDataUrl:
      input.config.showQr === true
        ? await renderSorteoTicketQrDataUrl(
            buildSorteoTicketQrPayload({
              numeroOrden: input.numeroOrden,
              cupones: input.cupones,
              clienteNombre: input.clienteNombre,
              documento: input.documento,
              telefono: input.telefono,
              sorteoNombre: input.sorteoNombre,
            }),
            560
          )
        : null,
  };

  const hasTemplate =
    withQr.templateBytes && withQr.templateBytes.length > 0 && withQr.templateMime;
  if (hasTemplate) {
    try {
      const png = await renderCustomTemplateTicketPng(withQr);
      const hash = createHash("sha256").update(png).digest("hex");
      return { png, hash };
    } catch (e) {
      console.warn("[sorteo-ticket-render] custom_template_failed_fallback_auto", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const svg = buildSorteoTicketSvg(withQr);
  return renderSorteoTicketPng(svg);
}
