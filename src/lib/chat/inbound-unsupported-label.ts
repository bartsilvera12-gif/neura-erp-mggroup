/**
 * Etiqueta legible para mensajes entrantes que no podemos renderizar.
 *
 * Meta manda `type: "unsupported"` cuando el mensaje no es representable por la
 * Cloud API (encuestas, "ver una vez", clientes no soportados, etc.), y suele
 * acompañarlo con `errors: [{ code: 131051, title: "Unsupported message type" }]`.
 * Sin esto el fallback de los extractores imprime el tipo crudo de la API
 * (`[unsupported]`) en el inbox.
 */
export const INBOUND_UNSUPPORTED_LABEL = "[mensaje no compatible]";

/** Tipos que ya vienen anunciados por el proveedor como no representables. */
function isOpaqueType(t: string): boolean {
  return !t || t === "unsupported" || t === "unknown";
}

export function inboundUnsupportedLabel(rawType?: string | null): string {
  const t = typeof rawType === "string" ? rawType.trim().toLowerCase() : "";
  if (isOpaqueType(t)) return INBOUND_UNSUPPORTED_LABEL;
  return `${INBOUND_UNSUPPORTED_LABEL} (${t})`;
}

/**
 * Título del primer error que adjunta el proveedor al mensaje entrante.
 * Solo para logs: viene en inglés desde Meta, no lo mostramos en la UI.
 */
export function readInboundErrorTitle(msg: unknown): string | null {
  if (msg == null || typeof msg !== "object") return null;
  const errors = (msg as Record<string, unknown>).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = errors[0];
  if (first == null || typeof first !== "object") return null;
  const e = first as Record<string, unknown>;
  const title = typeof e.title === "string" ? e.title.trim() : "";
  if (title) return title;
  const message = typeof e.message === "string" ? e.message.trim() : "";
  return message || null;
}
