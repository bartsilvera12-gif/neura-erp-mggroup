/**
 * Largo mínimo de una referencia para bloquear por repetida.
 *
 * Estaba en 12 y dejaba afuera a todos los bancos que se usan acá: Basa numera con 10 dígitos
 * y Familiar con 9. Con ese mínimo la detección de comprobantes reusados no se aplicaba nunca.
 *
 * Se pudo bajar recién después de arreglar de dónde sale la referencia: antes se guardaban
 * números de cuenta, que se repiten en todos los comprobantes de un banco, y bajar el mínimo
 * hubiera hecho rechazar compras buenas en masa.
 */
export const MIN_OCR_REF_LENGTH_FOR_STRONG_DUPLICATE = 8;

const OCR_REF_STRONG_BLOCKLIST = new Set(
  [
    "CONCEPTO",
    "VOLVER",
    "INICIO",
    "MENU",
    "PAGAR",
    "CANCELAR",
    "CONTINUAR",
    "ACEPTAR",
    "TRANSFERENCIA",
    "OPERACION",
    "OPERACIÓN",
    "COMPROBANTE",
    "IMPORTE",
    "MONTO",
  ].map((s) => s.toUpperCase())
);

/**
 * Digitos minimos para que algo parezca un numero de operacion.
 *
 * Es lo que separa una referencia de una etiqueta que el OCR agarro de mas. Un numero de
 * operacion siempre tiene digitos; "BENEFICIARIO", "TRANSFERENCIA" o "CONCEPTO" no. Con la
 * lista negra sola habia que ir agregando cada palabra nueva a mano —y ya se colo
 * "BENEFICIARIO", que hubiera bloqueado al siguiente comprobante que la leyera igual—.
 */
export const MIN_OCR_REF_DIGITS_FOR_STRONG_DUPLICATE = 6;

/** Solo refs que pueden usarse para bloqueo fuerte entre sesiones. */
export function ocrReferenceUsableForStrongDuplicate(ref: string | null | undefined): string | null {
  const r = (ref ?? "").trim().toUpperCase();
  if (r.length < MIN_OCR_REF_LENGTH_FOR_STRONG_DUPLICATE) return null;
  if (OCR_REF_STRONG_BLOCKLIST.has(r)) return null;
  const compact = r.replace(/[^A-Z0-9]/g, "");
  if (compact.length > 0 && OCR_REF_STRONG_BLOCKLIST.has(compact)) return null;
  /*
   * Sin digitos suficientes no se bloquea nada. Bloquear de mas es peor que bloquear de
   * menos: un comprobante repetido que pasa se revisa a mano, pero una compra buena rechazada
   * es un cliente que se va.
   */
  const digitos = r.replace(/\D/g, "").length;
  if (digitos < MIN_OCR_REF_DIGITS_FOR_STRONG_DUPLICATE) return null;
  return r;
}
