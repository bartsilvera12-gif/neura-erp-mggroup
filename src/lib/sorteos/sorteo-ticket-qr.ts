import "server-only";

import QRCode from "qrcode";

/**
 * QR del comprobante de sorteo: lleva el número de orden, los cupones y los datos del
 * comprador en texto plano, para que al escanearlo en la puerta se lea todo sin conexión.
 * No es una URL: no depende de que el sistema esté online ni expone ningún enlace.
 */

/** Tope de cupones listados dentro del QR; el resto se resume para no inflar la imagen. */
export const SORTEO_TICKET_QR_MAX_CUPONES = 20;

export type SorteoTicketQrData = {
  numeroOrden?: string | number | null;
  cupones?: string[];
  clienteNombre?: string | null;
  documento?: string | null;
  telefono?: string | null;
  ciudad?: string | null;
  sorteoNombre?: string | null;
};

function line(label: string, value: string | null | undefined): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? `${label}: ${v}` : null;
}

export function buildSorteoTicketQrPayload(data: SorteoTicketQrData): string {
  const cupones = (data.cupones ?? []).map((c) => String(c).trim()).filter(Boolean);
  const shown = cupones.slice(0, SORTEO_TICKET_QR_MAX_CUPONES);
  const cuponesText =
    shown.length === 0
      ? ""
      : cupones.length > shown.length
        ? `${shown.join(", ")} (+${cupones.length - shown.length})`
        : shown.join(", ");

  return [
    line("ORDEN", data.numeroOrden == null ? "" : String(data.numeroOrden)),
    line("CUPONES", cuponesText),
    line("CLIENTE", data.clienteNombre),
    line("DOC", data.documento),
    line("TEL", data.telefono),
    line("CIUDAD", data.ciudad),
    line("SORTEO", data.sorteoNombre),
  ]
    .filter((l): l is string => Boolean(l))
    .join("\n");
}

/**
 * PNG del QR como data URL, listo para incrustar en el SVG del comprobante.
 * Devuelve `null` si no hay nada que codificar o si la librería falla: el ticket
 * se sigue generando sin QR antes que romper la entrega al cliente.
 */
export async function renderSorteoTicketQrDataUrl(
  payload: string,
  sizePx: number
): Promise<string | null> {
  const text = payload.trim();
  if (!text) return null;
  try {
    const buf = await QRCode.toBuffer(text, {
      type: "png",
      width: Math.max(120, Math.round(sizePx)),
      /** Margen en módulos: sin zona blanca el lector falla sobre fondos oscuros. */
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000ff", light: "#ffffffff" },
    });
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.warn("[sorteo-ticket-qr] qr_render_failed", {
      message: e instanceof Error ? e.message : String(e),
      payloadLength: text.length,
    });
    return null;
  }
}
