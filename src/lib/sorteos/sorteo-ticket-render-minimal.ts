import "server-only";

import type { SorteoTicketRenderInput } from "@/lib/sorteos/sorteo-ticket-render";
import { measureTicketTextWidth, svgTextAsPath } from "@/lib/sorteos/sorteo-ticket-text-path";

/**
 * Comprobante "minimal": fondo blanco, logo centrado y datos en tipografía monoespaciada
 * alineados a la izquierda, con el QR grande centrado abajo (estilo boleta impresa simple).
 *
 * Se activa SOLO cuando `ticket_image_config.design_mode === "minimal"`, así que no cambia
 * el comprobante de ningún cliente que no lo pida. Reutiliza el mismo lienzo 1080×1350 y la
 * misma canalización de QR/PNG que los otros modos.
 */

const WA = 1080;
const HA = 1350;
const PAD = 76;

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

export function buildSorteoTicketMinimalSvg(input: SorteoTicketRenderInput): string {
  const cfg = input.config;
  const bg = "#ffffff";
  const ink = (cfg.primaryColor ?? "#111111").trim();

  const showLogo = cfg.showLogo !== false;
  const showNombre = cfg.showClienteNombre !== false;
  const showDoc = cfg.showDocumento !== false;
  const showTel = cfg.showTelefono !== false;
  const showOrd = cfg.showNumeroOrden !== false;
  const showCup = cfg.showCupones !== false;
  const showSorteoNom = cfg.showSorteoNombre !== false;

  const innerW = WA - PAD * 2;
  const leftX = PAD;
  const parts: string[] = [`<rect width="${WA}" height="${HA}" fill="${bg}"/>`];

  let y = 64;

  // ---------- Logo centrado ----------
  const hasLogo = showLogo && Boolean(input.logoBytes && input.logoMime);
  if (hasLogo) {
    const LW = 520;
    const LH = 300;
    parts.push(
      `<image href="${dataUrlFromBuffer(input.logoBytes!, input.logoMime!)}" x="${(WA - LW) / 2}" y="${y}" width="${LW}" height="${LH}" preserveAspectRatio="xMidYMid meet"/>`
    );
    y += LH + 36;
  } else if (showLogo) {
    parts.push(
      svgTextAsPath({
        text: input.empresaNombre.toUpperCase(),
        x: WA / 2,
        y: y + 52,
        fontSize: 48,
        weight: 800,
        fill: ink,
        textAnchor: "middle",
      })
    );
    y += 104;
  }

  // ---------- Datos, mono, alineados a la izquierda ----------
  const FS = 36;
  const WEIGHT = 700;
  const LINE_H = 54;

  const drawLine = (text: string) => {
    for (const linea of wrapMono(text, FS, WEIGHT, innerW, 3)) {
      y += FS;
      parts.push(
        svgTextAsPath({ text: linea, x: leftX, y, fontSize: FS, weight: WEIGHT, fill: ink, textAnchor: "start", family: "mono" })
      );
      y += LINE_H - FS;
    }
  };
  const drawSeparator = () => {
    y += 22;
    parts.push(
      `<line x1="${leftX}" y1="${y}" x2="${WA - PAD}" y2="${y}" stroke="${ink}" stroke-width="3" stroke-dasharray="11 11" opacity="0.9"/>`
    );
    y += 34;
  };

  if (showNombre && input.clienteNombre?.trim()) {
    drawLine(`CLIENTE: ${input.clienteNombre.trim().toUpperCase()}`);
  }
  const contacto: string[] = [];
  if (showDoc && input.documento?.trim()) contacto.push(`CI: ${input.documento.trim()}`);
  if (showTel && input.telefono?.trim()) contacto.push(`TEL: ${input.telefono.trim()}`);
  if (contacto.length > 0) drawLine(contacto.join(" | "));

  drawSeparator();

  if (showSorteoNom && input.sorteoNombre?.trim()) {
    /** Precio opcional al lado de la edición (ej. "· 10.000 GS"); config-driven, solo si está seteado. */
    const precioTexto =
      typeof (cfg as Record<string, unknown>).edicion_precio_texto === "string"
        ? String((cfg as Record<string, unknown>).edicion_precio_texto).trim()
        : "";
    const edicion = precioTexto
      ? `${input.sorteoNombre.trim()} · ${precioTexto}`
      : input.sorteoNombre.trim();
    drawLine(`EDICION: ${edicion.toUpperCase()}`);
  }
  if (showOrd && String(input.numeroOrden ?? "").trim()) {
    drawLine(`NRO: #${String(input.numeroOrden).trim()}`);
  }
  const cupones = showCup ? input.cupones.map((c) => String(c).trim()).filter(Boolean) : [];
  if (cupones.length > 0) {
    drawLine(`${cupones.length === 1 ? "CUPON" : "CUPONES"}: ${cupones.join(", ")}`);
  }

  // ---------- QR grande centrado abajo (sin fecha) ----------
  if (input.qrDataUrl) {
    const top = y + 52;
    const QR = Math.max(380, Math.min(640, HA - PAD - top));
    const qrX = (WA - QR) / 2;
    parts.push(`<image href="${input.qrDataUrl}" x="${qrX}" y="${top}" width="${QR}" height="${QR}"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WA}" height="${HA}" viewBox="0 0 ${WA} ${HA}">
  ${parts.filter(Boolean).join("\n  ")}
</svg>`;
}
