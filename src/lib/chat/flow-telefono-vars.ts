/**
 * Teléfono del cliente disponible como variable del flujo.
 *
 * Muchos flujos no piden el número: ya lo tienen del propio WhatsApp. Sin esto,
 * escribir `{{telefono}}` en un mensaje de confirmación salía vacío y había que
 * agregar un paso que preguntara algo que el sistema ya sabía.
 */

export const TELEFONO_KEYS = {
  local: "telefono",
  internacional: "telefono_internacional",
} as const;

/**
 * Teléfono como lo reconoce quien lo lee.
 *
 * Paraguayo en formato local: `595971988431` → `0971988431`. De otro país, con el `+`
 * adelante: `5491123456789` → `+5491123456789`; sin él, un número argentino o brasileño en
 * la boleta parecía un código cualquiera. No se inventan prefijos: un número local sin código
 * de país (empieza con 0 o es corto) se devuelve tal cual.
 */
export function toTelefonoLocalPy(digits: string): string {
  const d = digits.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("595") && d.length >= 11 && d.length <= 13) return `0${d.slice(3)}`;
  if (d.length >= 11 && !d.startsWith("0")) return `+${d}`;
  return d;
}

/** Variables a fusionar; solo rellenan si el flujo no capturó un teléfono propio. */
export function buildTelefonoVars(
  toDigits: string | null | undefined,
  flowData: Record<string, string>
): Record<string, string> {
  const d = String(toDigits ?? "").replace(/\D+/g, "");
  if (!d) return {};
  const vars: Record<string, string> = { [TELEFONO_KEYS.internacional]: d };
  if (!String(flowData.telefono ?? "").trim()) {
    vars[TELEFONO_KEYS.local] = toTelefonoLocalPy(d);
  }
  return vars;
}
