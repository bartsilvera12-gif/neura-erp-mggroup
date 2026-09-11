/**
 * Validación de la respuesta en pasos de captura de texto.
 *
 * Sirve para pedir la cantidad de boletas escribiéndola en vez de con botones:
 * si el cliente responde cualquier otra cosa, el bot repregunta y el flujo no avanza.
 */

export type FlowInputValidation = "none" | "number" | "title_case" | "documento" | "telefono";

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
  if (raw === "documento") return "documento";
  if (raw === "telefono") return "telefono";
  return "none";
}

/** Motivos por los que se repregunta en vez de avanzar. */
export type FlowInputFailReason =
  | "not_a_number"
  | "out_of_range"
  | "over_max"
  | "not_a_document"
  | "not_a_phone";

export const DEFAULT_INVALID_DOCUMENT_MESSAGE =
  "Escribí tu número de documento: cédula, RUC o pasaporte. Ej: 4567890 o AB1234567";

export const DEFAULT_INVALID_PHONE_MESSAGE =
  "Escribí tu número de teléfono. Si no es de Paraguay, con el código del país. Ej: 0981123456 o +54 9 11 2345 6789";

/**
 * Documento de identidad: cédula paraguaya, RUC, o el pasaporte o documento de otro país.
 *
 * Existe porque el paso de la cédula se configuraba como «Solo un número», y eso deja afuera a
 * cualquier extranjero: un pasaporte lleva letras (AB1234567), un CPF brasileño guiones. El bot
 * repreguntaba sin fin y la persona no podía comprar. Además la validación de número guarda el
 * valor como número, y a un documento que empieza con 0 le borraba el cero.
 *
 * Acepta letras, dígitos y guiones; saca espacios y puntos, que la gente pone por costumbre
 * («4.567.890»). Pide al menos un dígito para que «no tengo» o «después» no pasen como un
 * documento.
 */
function checkDocumento(value: string): FlowInputCheck {
  const limpio = value.trim().toUpperCase().replace(/[\s.]/g, "");
  if (!/^[A-Z0-9-]+$/.test(limpio)) return { ok: false, reason: "not_a_document" };
  const alfanumerico = limpio.replace(/-/g, "");
  if (alfanumerico.length < 4 || alfanumerico.length > 20) return { ok: false, reason: "not_a_document" };
  if (!/\d/.test(alfanumerico)) return { ok: false, reason: "not_a_document" };
  return { ok: true, value: limpio };
}

/**
 * Teléfono de cualquier país.
 *
 * Tolera lo que la gente escribe al copiar un número extranjero —«+54 9 11 2345-6789»,
 * paréntesis, puntos— y guarda solo los dígitos, sin perder el 0 de adelante de un número
 * local paraguayo. Entre 7 y 15 dígitos: el máximo de la numeración internacional.
 */
function checkTelefono(value: string): FlowInputCheck {
  const bruto = value.trim();
  if (!/^\+?[\d\s().\-]+$/.test(bruto)) return { ok: false, reason: "not_a_phone" };
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 7 || digitos.length > 15) return { ok: false, reason: "not_a_phone" };
  return { ok: true, value: digitos };
}

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
  if (validation === "documento") return checkDocumento(value);
  if (validation === "telefono") return checkTelefono(value);
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
  if (t) return t;
  if (reason === "not_a_document") return DEFAULT_INVALID_DOCUMENT_MESSAGE;
  if (reason === "not_a_phone") return DEFAULT_INVALID_PHONE_MESSAGE;
  return DEFAULT_INVALID_NUMBER_MESSAGE;
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
