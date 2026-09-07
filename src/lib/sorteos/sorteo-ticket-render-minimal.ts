import "server-only";

import type { SorteoTicketRenderInput } from "@/lib/sorteos/sorteo-ticket-render";
import { measureTicketTextWidth, svgTextAsPath } from "@/lib/sorteos/sorteo-ticket-text-path";

/**
 * Comprobante "minimal": el mismo formato que la boleta impresa.
 *
 * Arriba el logo a la izquierda y el QR a la derecha; abajo el comprador, sus datos en una
 * línea, la edición, el número grande, la fecha y el importe. Antes el QR ocupaba media
 * boleta abajo y los datos iban todos apilados a la izquierda; se cambió para que la imagen
 * que llega por WhatsApp y el papel que sale de la impresora se lean igual.
 *
 * Se activa SOLO cuando `ticket_image_config.estilo_minimal === true`, así que no cambia el
 * comprobante de ningún cliente que no lo pida. Reutiliza el mismo lienzo 1080×1350 y la
 * misma canalización de QR/PNG que los otros modos.
 */

const WA = 1080;
const HA = 1350;
const PAD = 76;

const PYG = new Intl.NumberFormat("es-PY");
const gs = (n: number) => PYG.format(Math.round(n || 0)) + " Gs.";

function dataUrlFromBuffer(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Envuelve por palabra en fuente mono; corta a `maxLines` (la última puede quedar larga). */
function wrapMono(text: string, fs: number, weight: number, maxW: number, maxLines: number): string[] {
  const palabras = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (palabras.length === 0) return [];
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of palabras) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra;
    if (measureTicketTextWidth(tentativa, fs, weight, "mono") <= maxW) {
      actual = tentativa;
      continue;
    }
    if (actual) lineas.push(actual);
    actual = palabra;
    if (lineas.length >= maxLines - 1) break;
  }
  if (actual) lineas.push(actual);
  return lineas.slice(0, maxLines);
}

/** Solo la fecha: la hora no le dice nada a quien recibe la boleta. */
function soloFecha(fechaHora: string): string {
  const t = (fechaHora ?? "").trim();
  if (!t) return "";
  /** `fechaHora` llega ya formateada ("7/9/26, 11:30"); si trae hora, se corta en la coma. */
  const coma = t.indexOf(",");
  return (coma > 0 ? t.slice(0, coma) : t).trim();
}

export function buildSorteoTicketMinimalSvg(input: SorteoTicketRenderInput): string {
  const cfg = input.config;
  const bg = "#ffffff";
  const ink = (cfg.primaryColor ?? "#111111").trim();

  const showLogo = cfg.showLogo !== false;
  const showNombre = cfg.showClienteNombre !== false;
  const showDoc = cfg.showDocumento !== false;
  const showTel = cfg.showTelefono !== false;
  const showCup = cfg.showCupones !== false;
  const showSorteoNom = cfg.showSorteoNombre !== false;
  const showCiudad = cfg.showCiudad !== false;

  const innerW = WA - PAD * 2;
  const leftX = PAD;
  const parts: string[] = [`<rect width="${WA}" height="${HA}" fill="${bg}"/>`];

  // ---------- Encabezado: logo a la izquierda, QR a la derecha ----------
  /** Proporciones tomadas del modelo que aprobó el cliente. */
  const QR = 330;
  const cabeceraY = 120;
  const hayLogo = showLogo && Boolean(input.logoBytes && input.logoMime);
  const hayQr = Boolean(input.qrDataUrl);

  if (hayQr) {
    parts.push(
      `<image href="${input.qrDataUrl}" x="${WA - PAD - QR}" y="${cabeceraY}" width="${QR}" height="${QR}"/>`
    );
  }

  /** El logo no puede meterse debajo del QR: se le deja el ancho que sobra. */
  const anchoLogo = hayQr ? innerW - QR - 48 : innerW;
  if (hayLogo) {
    parts.push(
      `<image href="${dataUrlFromBuffer(input.logoBytes!, input.logoMime!)}" x="${leftX}" y="${cabeceraY}" width="${anchoLogo}" height="${QR}" preserveAspectRatio="xMinYMid meet"/>`
    );
  } else if (showLogo) {
    parts.push(
      svgTextAsPath({
        text: input.empresaNombre.toUpperCase(),
        x: leftX,
        y: cabeceraY + QR / 2 + 16,
        fontSize: 48,
        weight: 800,
        fill: ink,
        textAnchor: "start",
      })
    );
  }

  let y = cabeceraY + (hayLogo || hayQr || showLogo ? QR : 0) + 130;

  // ---------- Cuerpo ----------
  const linea = (
    text: string,
    opciones: { fs: number; weight: number; centrado: boolean; maxLines?: number }
  ) => {
    const { fs, weight, centrado } = opciones;
    for (const l of wrapMono(text, fs, weight, innerW, opciones.maxLines ?? 3)) {
      y += fs;
      parts.push(
        svgTextAsPath({
          text: l,
          x: centrado ? WA / 2 : leftX,
          y,
          fontSize: fs,
          weight,
          fill: ink,
          textAnchor: centrado ? "middle" : "start",
          family: "mono",
        })
      );
      y += 18;
    }
  };

  if (showNombre && input.clienteNombre?.trim()) {
    linea(input.clienteNombre.trim().toUpperCase(), { fs: 44, weight: 800, centrado: true, maxLines: 2 });
    y += 14;
  }

  /** Documento, ciudad y celular en un solo renglón, como lo pidió el cliente. */
  const contacto: string[] = [];
  if (showDoc && input.documento?.trim()) contacto.push(`CI: ${input.documento.trim()}`);
  if (showCiudad && input.ciudad?.trim()) contacto.push(`CIUDAD: ${input.ciudad.trim().toUpperCase()}`);
  if (showTel && input.telefono?.trim()) contacto.push(`Cel: ${input.telefono.trim()}`);
  if (contacto.length > 0) {
    linea(contacto.join("  |  "), { fs: 32, weight: 600, centrado: true, maxLines: 2 });
    y += 14;
  }

  if (showSorteoNom && input.sorteoNombre?.trim()) {
    /** Precio opcional al lado de la edición (ej. "A: 10.000 GS"); config-driven. */
    const precioTexto =
      typeof (cfg as Record<string, unknown>).edicion_precio_texto === "string"
        ? String((cfg as Record<string, unknown>).edicion_precio_texto).trim()
        : "";
    const edicion = precioTexto
      ? `${input.sorteoNombre.trim()} A: ${precioTexto}`
      : input.sorteoNombre.trim();
    linea(`EDICIÓN: ${edicion.toUpperCase()}`, { fs: 32, weight: 700, centrado: true, maxLines: 3 });
    y += 20;
  }

  const cupones = showCup ? input.cupones.map((c) => String(c).trim()).filter(Boolean) : [];
  if (cupones.length > 0) {
    linea(`NRO: ${cupones.join("  ")}`, { fs: 76, weight: 800, centrado: false, maxLines: 2 });
    y += 12;
  }

  const fecha = soloFecha(input.fechaHora);
  if (fecha) linea(`FECHA: ${fecha}`, { fs: 32, weight: 600, centrado: false, maxLines: 1 });

  if (typeof input.montoTotal === "number" && input.montoTotal > 0) {
    linea(gs(input.montoTotal), { fs: 32, weight: 600, centrado: false, maxLines: 1 });
  }

  // ---------- Pie ----------
  parts.push(
    svgTextAsPath({
      text: "¡Gracias por tu compra!",
      x: WA / 2,
      y: HA - PAD,
      fontSize: 34,
      weight: 600,
      fill: ink,
      textAnchor: "middle",
      family: "mono",
    })
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WA}" height="${HA}" viewBox="0 0 ${WA} ${HA}">
  ${parts.filter(Boolean).join("\n  ")}
</svg>`;
}
