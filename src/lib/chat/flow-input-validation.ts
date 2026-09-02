/**
 * Validación de la respuesta en pasos de captura de texto.
 *
 * Sirve para pedir la cantidad de boletas escribiéndola en vez de con botones:
 * si el cliente responde cualquier otra cosa, el bot repregunta y el flujo no avanza.
 */

export type FlowInputValidation = "none" | "number" | "title_case";

/** Conectores que en español van en minúscula salvo que abran el texto. */
const CONECTORES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "el"]);

/**
 * Capitaliza nombres y ciudades: «ciudad del este» → «Ciudad del Este».
 * Conserva las siglas cortas ya escritas en mayúscula (CDE, EEUU) para no romperlas.
 */
export function toTitleCaseEs(value: string): string {
  const limpio = value.trim().replace(/\s+/g, " ");
  const palabras = limpio.split(" ");
  /**
   * Si TODO viene en mayúscula («CIUDAD DEL ESTE») no se puede distinguir una sigla de
   * un grito, así que se capitaliza todo. La excepción es una palabra sola y corta
   * («CDE»), que casi siempre es una sigla de verdad.
   */
  const todoMayusculas =
    /\p{L}/u.test(limpio) && limpio === limpio.toLocaleUpperCase("es") && palabras.length > 1;
  return palabras
    .map((palabra, i) => {
      if (!palabra) return palabra;
      const soloLetras = palabra.replace(/[^\p{L}]/gu, "");
      if (
        !todoMayusculas &&
        soloLetras.length > 1 &&
        soloLetras.length <= 4 &&
        palabra === palabra.toLocaleUpperCase("es")
      ) {
        return palabra;
      }
      const baja = palabra.toLocaleLowerCase("es");
      if (i > 0 && CONECTORES.has(baja)) return baja;
      return baja.charAt(0).toLocaleUpperCase("es") + baja.slice(1);
    })
    .join(" ");
}

export const DEFAULT_INVALID_NUMBER_MESSAGE = "Respondé únicamente el número, por favor. Ej: 2";

/**
 * Tope técnico, no de negocio: evita desbordar el rango seguro de JS con un pegote de
 * dígitos. El límite real de cada paso se configura con `input_max_value`.
 *
 * Estaba en 6 y rechazaba cualquier cédula de 7 dígitos: el tope pensado para la
 * cantidad de boletas no puede aplicarse a todos los campos numéricos.
 */
const MAX_NUMBER_DIGITS = 15;

export function normalizeFlowInputValidation(raw: unknown): FlowInputValidation {
  if (raw === "number") return "number";
  if (raw === "title_case") return "title_case";
  return "none";
}

/** Motivos por los que se repregunta en vez de avanzar. */
export type FlowInputFailReason = "not_a_number" | "out_of_range" | "over_max";

export type FlowInputCheck =
  | { ok: true; value: string }
  | { ok: false; reason: FlowInputFailReason };

/**
 * Acepta solo dígitos, tolerando espacios y separadores de miles que la gente
 * escribe sin pensar («1.000», «1 000»). No interpreta palabras: si el cliente
 * escribe «dos» o «quiero 3 boletas» se repregunta, que es lo pedido.
 */
export function checkFlowInput(
  value: string,
  validation: FlowInputValidation,
  maxValue?: number | null
): FlowInputCheck {
  if (validation === "title_case") return { ok: true, value: toTitleCaseEs(value) };
  if (validation !== "number") return { ok: true, value: value.trim() };

  const bruto = value.trim();
  let digitos: string;
  if (/^\d+$/.test(bruto)) {
    digitos = bruto;
  } else if (/^\d{1,3}([.,\s]\d{3})+$/.test(bruto)) {
    /**
     * Solo se aceptan separadores de miles en grupos de tres («1.000»). Antes se borraba
     * cualquier punto y «2.5» entraba como 25 boletas: un decimal tiene que repreguntarse.
     */
    digitos = bruto.replace(/[.,\s]/g, "");
  } else {
    return { ok: false, reason: "not_a_number" };
  }

  if (digitos.length > MAX_NUMBER_DIGITS) return { ok: false, reason: "out_of_range" };
  const n = Number(digitos);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "out_of_range" };
  const tope = typeof maxValue === "number" && Number.isFinite(maxValue) && maxValue > 0 ? maxValue : null;
  if (tope != null && n > tope) return { ok: false, reason: "over_max" };
  /** Se guarda normalizado: «01» y «1 » quedan iguales para el resto del flujo. */
  return { ok: true, value: String(n) };
}

export function flowInputInvalidMessage(
  custom: string | null | undefined,
  reason?: FlowInputFailReason,
  maxValue?: number | null
): string {
  /**
   * Pasarse del tope necesita su propio texto: el mensaje configurado habla de responder
   * un numero, y el cliente ya respondio uno. Hay que decirle cual es el maximo.
   */
  if (reason === "over_max" && typeof maxValue === "number" && maxValue > 0) {
    return `Podés comprar hasta ${maxValue} por compra. Respondé un número entre 1 y ${maxValue}.`;
  }
  const t = typeof custom === "string" ? custom.trim() : "";
  return t || DEFAULT_INVALID_NUMBER_MESSAGE;
}

/**
 * Confirmación del dato recién capturado, para pegar arriba del mensaje del paso
 * siguiente: «✅ CI: 6160627». Sin etiqueta configurada no se muestra nada.
 */
export function buildCaptureConfirmation(
  label: string | null | undefined,
  value: string
): string | undefined {
  const l = typeof label === "string" ? label.trim() : "";
  const v = value.trim();
  if (!l || !v) return undefined;
  return `✅ ${l}: ${v}`;
}
