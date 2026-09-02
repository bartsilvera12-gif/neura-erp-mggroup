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

/** Trunca con «…» para que un valor largo (nombre del sorteo) no se salga de la tarjeta. */
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

/**
 * Bloque de cupones: rótulo + números, centrados, dentro del alto disponible.
 * Devuelve también el alto usado para poder ubicar el QR debajo sin superponerse.
 */
function cuponesBlockSvg(opts: {
  cupones: string[];
  cx: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  primary: string;
  accent: string;
}): { svg: string; height: number } {
  const { cupones, cx, top, maxWidth, maxHeight, primary, accent } = opts;
  if (cupones.length === 0) return { svg: "", height: 0 };

  const LABEL_FS = 22;
  const LABEL_GAP = 16;
  const pieces: string[] = [
    svgTextAsPath({
      text: cupones.length === 1 ? "TU CUPÓN" : "TUS CUPONES",
      x: cx,
      y: top + LABEL_FS,
      fontSize: LABEL_FS,
      weight: 700,
      fill: accent,
      textAnchor: "middle",
    }),
  ];

  const listTop = top + LABEL_FS + LABEL_GAP;
  const available = Math.max(60, maxHeight - (LABEL_FS + LABEL_GAP));

  /** Pocos cupones: lista vertical grande. Muchos: grilla de 3 columnas. */
  if (cupones.length <= 6) {
    let fs = 84;
    while (fs > 30 && (cupones.length * fs * 1.22 > available || anyTooWide(cupones, fs, 800, maxWidth))) {
      fs -= 4;
    }
    const lineH = fs * 1.22;
    let y = listTop;
    for (const c of cupones) {
      y += fs;
      pieces.push(
        svgTextAsPath({ text: c, x: cx, y, fontSize: fs, weight: 800, fill: primary, textAnchor: "middle" })
      );
      y += lineH - fs;
    }
    return { svg: pieces.filter(Boolean).join("\n"), height: y - top };
  }

  const MAX_SHOW = 24;
  const list = cupones.slice(0, MAX_SHOW);
  const cols = 3;
  const rows = Math.ceil(list.length / cols);
  let fs = 34;
  while (fs > 16 && rows * fs * 1.5 > available - 30) fs -= 2;
  const rowH = fs * 1.5;
  const cellW = maxWidth / cols;
  const x0 = cx - maxWidth / 2 + cellW / 2;
  list.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pieces.push(
      svgTextAsPath({
        text: c,
        x: x0 + col * cellW,
        y: listTop + fs + row * rowH,
        fontSize: fs,
        weight: 700,
        fill: primary,
        textAnchor: "middle",
      })
    );
  });
  let height = LABEL_FS + LABEL_GAP + rows * rowH;
  if (cupones.length > MAX_SHOW) {
    pieces.push(
      svgTextAsPath({
        text: `y ${cupones.length - MAX_SHOW} cupones más`,
        x: cx,
        y: top + height + 24,
        fontSize: 20,
        weight: 600,
        fill: accent,
        textAnchor: "middle",
      })
    );
    height += 32;
  }
  return { svg: pieces.filter(Boolean).join("\n"), height };
}

function anyTooWide(items: string[], fontSize: number, weight: number, maxWidth: number): boolean {
  return items.some((t) => measureTicketTextWidth(t, fontSize, weight) > maxWidth);
}

/**
 * Modo automático: banda superior oscura con el logo, tarjeta blanca con los datos,
 * cupones destacados y QR al pie.
 *
 * Todo se ubica con un cursor vertical y medidas reales de texto: antes las posiciones
 * eran offsets fijos y el título quedaba tapado por la tarjeta y el rótulo de cupones
 * se superponía con el primer número.
 */
export function buildSorteoTicketSvg(input: SorteoTicketRenderInput): string {
  const cfg = input.config;
  const bg = (cfg.backgroundColor ?? "#eef2f6").trim();
  const primary = (cfg.primaryColor ?? "#0f172a").trim();
  const secondary = (cfg.secondaryColor ?? "#64748b").trim();
  const accent = (cfg.primaryColor ?? "#b45309").trim();
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

  // ---- Banda superior (oscura): logo + empresa ----
  const LOGO = 190;
  const bandH = hasLogo ? 336 : 250;
  const parts: string[] = [];

  parts.push(`<rect width="${WA}" height="${HA}" fill="${bg}"/>`);
  if (input.backgroundBytes && input.backgroundMime) {
    const href = dataUrlFromBuffer(input.backgroundBytes, input.backgroundMime);
    parts.push(
      `<image href="${href}" x="0" y="0" width="${WA}" height="${HA}" preserveAspectRatio="xMidYMid slice" opacity="0.10"/>`
    );
  }
  parts.push(`<rect x="0" y="0" width="${WA}" height="${bandH}" fill="${primary}"/>`);

  let y = PAD;
  if (hasLogo) {
    const href = dataUrlFromBuffer(input.logoBytes!, input.logoMime!);
    parts.push(
      `<image href="${href}" x="${cx - LOGO / 2}" y="${y}" width="${LOGO}" height="${LOGO}" preserveAspectRatio="xMidYMid meet"/>`
    );
    y += LOGO + 30;
  } else if (showLogo) {
    const r = 56;
    parts.push(`<circle cx="${cx}" cy="${y + r}" r="${r}" fill="#ffffff" opacity="0.10"/>`);
    parts.push(
      svgTextAsPath({
        text: initials(input.empresaNombre),
        x: cx,
        y: y + r + 18,
        fontSize: 48,
        weight: 800,
        fill: "#ffffff",
        textAnchor: "middle",
      })
    );
    y += r * 2 + 26;
  }

  const empresaFs = 32;
  parts.push(
    svgTextAsPath({
      text: truncateToWidth(input.empresaNombre, empresaFs, 800, WA - PAD * 2),
      x: cx,
      y: y + empresaFs,
      fontSize: empresaFs,
      weight: 800,
      fill: "#ffffff",
      textAnchor: "middle",
    })
  );

  // ---- Título, debajo de la banda ----
  const titleFs = 36;
  const titleBaseline = bandH + 58;
  parts.push(
    svgTextAsPath({
      text: truncateToWidth(title, titleFs, 700, WA - PAD * 2),
      x: cx,
      y: titleBaseline,
      fontSize: titleFs,
      weight: 700,
      fill: primary,
      textAnchor: "middle",
    })
  );

  // ---- Tarjeta de datos ----
  const rows: { label: string; value: string; wide: boolean }[] = [];
  if (showNombre && input.clienteNombre?.trim()) {
    rows.push({ label: "Participante", value: input.clienteNombre.trim(), wide: true });
  }
  if (showDoc && input.documento?.trim()) rows.push({ label: "Documento", value: input.documento.trim(), wide: false });
  if (showTel && input.telefono?.trim()) rows.push({ label: "Teléfono", value: input.telefono.trim(), wide: false });
  if (showOrd && String(input.numeroOrden ?? "").trim()) {
    rows.push({ label: "Nº de orden", value: String(input.numeroOrden).trim(), wide: false });
  }
  if (showSorteoNom && input.sorteoNombre?.trim()) {
    rows.push({ label: "Sorteo", value: input.sorteoNombre.trim(), wide: true });
  }

  /** Los campos cortos van de a dos por línea: así la tarjeta ocupa menos y el cupón manda. */
  const lines: (typeof rows)[] = [];
  let pendiente: (typeof rows)[number] | null = null;
  for (const row of rows) {
    if (row.wide) {
      if (pendiente) {
        lines.push([pendiente]);
        pendiente = null;
      }
      lines.push([row]);
      continue;
    }
    if (pendiente) {
      lines.push([pendiente, row]);
      pendiente = null;
    } else {
      pendiente = row;
    }
  }
  if (pendiente) lines.push([pendiente]);

  const cardX = PAD;
  const cardW = WA - PAD * 2;
  const cardTop = titleBaseline + 34;
  const CARD_PAD = 36;
  const LABEL_FS = 19;
  const VALUE_FS = 29;
  const LINE_H = 88;
  const cardH = lines.length > 0 ? CARD_PAD * 2 + lines.length * LINE_H - 18 : 0;

  if (lines.length > 0) {
    parts.push(
      `<rect x="${cardX}" y="${cardTop}" width="${cardW}" height="${cardH}" rx="${CARD_RX}" fill="#ffffff" filter="url(#cardShadow)"/>`
    );
    let ry = cardTop + CARD_PAD;
    for (const line of lines) {
      const colW = line.length === 2 ? (cardW - CARD_PAD * 2) / 2 - 12 : cardW - CARD_PAD * 2;
      line.forEach((cell, ci) => {
        const cxCell = cardX + CARD_PAD + ci * ((cardW - CARD_PAD * 2) / 2 + 12);
        parts.push(
          svgTextAsPath({
            text: cell.label.toUpperCase(),
            x: cxCell,
            y: ry + LABEL_FS,
            fontSize: LABEL_FS,
            weight: 600,
            fill: secondary,
            textAnchor: "start",
          }),
          svgTextAsPath({
            text: truncateToWidth(cell.value, VALUE_FS, 700, colW),
            x: cxCell,
            y: ry + LABEL_FS + 16 + VALUE_FS,
            fontSize: VALUE_FS,
            weight: 700,
            fill: primary,
            textAnchor: "start",
          })
        );
      });
      ry += LINE_H;
    }
  }

  // ---- Pie: fecha y nota legal (se reservan primero para no pisarlos) ----
  const footerBaseline = HA - PAD;
  const fechaBaseline = footer ? footerBaseline - 34 : footerBaseline;

  // ---- QR, anclado sobre el pie ----
  const QR = 190;
  const qrBottom = fechaBaseline - 46;
  const qrTop = qrBottom - QR;
  if (input.qrDataUrl) {
    parts.push(
      `<rect x="${cx - QR / 2 - 10}" y="${qrTop - 10}" width="${QR + 20}" height="${QR + 20}" rx="14" fill="#ffffff"/>`,
      `<image href="${input.qrDataUrl}" x="${cx - QR / 2}" y="${qrTop}" width="${QR}" height="${QR}"/>`
    );
  }

  // ---- Cupones, en el espacio que queda entre la tarjeta y el QR ----
  const cuponesTop = (lines.length > 0 ? cardTop + cardH : titleBaseline) + 48;
  const cuponesBottomLimit = (input.qrDataUrl ? qrTop : fechaBaseline) - 34;
  const cupones = showCup ? input.cupones.map((c) => String(c).trim()).filter(Boolean) : [];
  if (cupones.length > 0) {
    const disponible = Math.max(80, cuponesBottomLimit - cuponesTop);
    const medida = cuponesBlockSvg({ cupones, cx, top: cuponesTop, maxWidth: cardW, maxHeight: disponible, primary, accent });
    /** Centrado vertical en el hueco: si no, con uno o dos cupones el bloque queda pegado a la tarjeta. */
    const offset = Math.max(0, Math.round((disponible - medida.height) / 2));
    const block =
      offset > 0
        ? cuponesBlockSvg({ cupones, cx, top: cuponesTop + offset, maxWidth: cardW, maxHeight: disponible - offset, primary, accent })
        : medida;
    parts.push(block.svg);
  }

  parts.push(
    svgTextAsPath({
      text: input.fechaHora,
      x: cx,
      y: fechaBaseline,
      fontSize: 22,
      weight: 400,
      fill: secondary,
      textAnchor: "middle",
    })
  );
  if (footer) {
    parts.push(
      svgTextAsPath({
        text: truncateToWidth(footer, 19, 400, WA - PAD * 2),
        x: cx,
        y: footerBaseline,
        fontSize: 19,
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
