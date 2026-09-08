import { createHash } from "crypto";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  MIN_OCR_REF_LENGTH_FOR_STRONG_DUPLICATE,
  ocrReferenceUsableForStrongDuplicate,
} from "@/lib/chat/comprobante-ocr-strong-dup-ref";
import {
  COMPROBANTE_BUTTON_IDS,
  type ComprobanteEstadoValidacion,
  type ComprobanteValidationSettings,
  type OnMissingBehavior,
  type OcrFieldKey,
  parseComprobanteValidationConfig,
  SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD,
  SORTEO_COMPROBANTE_HASH_FIELD,
  SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD,
  SORTEO_COMPROBANTE_OCR_BANCO_FIELD,
  SORTEO_COMPROBANTE_OCR_FECHA_FIELD,
  SORTEO_COMPROBANTE_OCR_HORA_FIELD,
  SORTEO_COMPROBANTE_OCR_MONTO_FIELD,
  SORTEO_COMPROBANTE_OCR_REF_FIELD,
  SORTEO_COMPROBANTE_OCR_TEXT_FIELD,
  SORTEO_COMPROBANTE_VALIDACION_ID_FIELD,
} from "@/lib/chat/comprobante-validation-types";
import { runGoogleVisionDocumentOcr } from "@/lib/chat/comprobante-vision-ocr";
import { evaluarFechaComprobante } from "@/lib/chat/comprobante-fecha-validation";
import {
  DEFAULT_MONTO_FIELDS_PRIORIDAD,
  fetchExpectedMontoGsFromFlowSession,
  validateReceiptAmountAgainstFlow,
} from "@/lib/chat/comprobante-monto-flow-validation";
import { buildMontoCalculadoVars, MONTO_CALCULADO_KEYS } from "@/lib/chat/flow-monto-calculado";
import {
  selectReceiptMontoFromOcrText,
  type MontoOcrSelectionAudit,
  type SelectReceiptMontoFromOcrOptions,
} from "@/lib/chat/comprobante-ocr-monto-selection";
import {
  ocrReferenciaMatchesConfiguredMerchantIdentifiers,
  validateReceiptBankDataAgainstExpected,
} from "@/lib/chat/comprobante-bank-data-validation";
import {
  SORTEO_COMPROBANTE_MEDIA_ID_FIELD,
  SORTEO_COMPROBANTE_URL_FIELD,
} from "@/lib/sorteos/sorteo-order-from-chat";

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export { MIN_OCR_REF_LENGTH_FOR_STRONG_DUPLICATE, ocrReferenceUsableForStrongDuplicate };

/**
 * Estados en los que un hash ya visto implica “no reenviar la misma imagen” para bloqueo temprano.
 * No incluye `ocr_error`: permite reintentar OCR con el mismo archivo sin mensaje de hash duplicado.
 */
const ESTADOS_HASH_BLOQUEA_REUSO: ComprobanteEstadoValidacion[] = [
  "valido",
  "revision_manual",
  "duplicado_hash",
  "duplicado_ocr",
  "monto_incoherente",
  "datos_bancarios_incoherentes",
  "comprobante_reenviado",
  "comprobante_vencido",
];

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function ocrFingerprint(fullText: string): string {
  const n = normalizeWs(fullText).toLowerCase();
  if (!n) return "";
  return createHash("sha256").update(n, "utf8").digest("hex");
}

function maskComprobanteRefForLog(r: string | null | undefined): string {
  const t = (r ?? "").trim();
  if (!t) return "";
  if (t.length <= 4) return "****";
  return `${t.slice(0, 2)}…(${t.length})`;
}

/**
 * Huellas sobre texto OCR muy corto colisionan entre comprobantes distintos (mismo encabezado de banco).
 * Solo tiene sentido comparar huellas largas; coincidencias débiles van a revisión humana.
 */
const MIN_CHARS_FOR_OCR_FINGERPRINT_CHECK = 120;

/** Motivo persistido cuando solo coincide huella OCR vs otro historial (sin referencia robusta). */
export const MOTIVO_REVISION_HUELLA_OCR_DEBIL = "ocr_huella_similar_revision";

export type ExtractedReceiptFields = {
  monto: string;
  referencia: string;
  fecha: string;
  hora: string;
  banco: string;
  texto_completo: string;
  /** Auditoría del selector de monto OCR (opcional) */
  monto_ocr_audit?: MontoOcrSelectionAudit | null;
};

/**
 * Etiquetas que de verdad anteceden al número de operación.
 *
 * Se buscan primero, y aparte de las genéricas, porque en un comprobante el número de cuenta
 * suele ir ANTES que el de operación y viene rotulado «Nro.» o «N°». Con una sola expresión
 * que mezclara todas las etiquetas ganaba la que apareciera primero en el texto, o sea la
 * cuenta: por eso quedaban guardadas cuentas de destino en vez de referencias. Y una cuenta
 * se repite en todos los comprobantes de ese banco, que es exactamente lo que no sirve para
 * detectar un pago repetido —y lo que haría rechazar compras buenas—.
 */
const REF_ETIQUETA_ESPECIFICA =
  /(?:comprobante|operaci[oó]n|transacci[oó]n|referencia)\s*[:\s.\-]*([A-Z0-9][A-Z0-9\-/.]{5,})/i;

/** Etiquetas genéricas: solo si no apareció ninguna específica. */
const REF_ETIQUETA_GENERICA = /(?:n[°º]|cod\.?|nro\.?|ref\.?)\s*[:\s.\-]*([A-Z0-9][A-Z0-9\-/.]{5,})/gi;

/** Lo que en el texto anterior delata que ese número es una cuenta, no una operación. */
const PISTAS_DE_CUENTA = /(cuenta|cta\.?|ah\s*-|\bah\b|alias|ruc|c\.?i\.?)\s*[:\-]?\s*$/i;

export function extraerReferenciaDeComprobante(texto: string): string {
  const especifica = texto.match(REF_ETIQUETA_ESPECIFICA);
  if (especifica?.[1]) return especifica[1].trim();

  REF_ETIQUETA_GENERICA.lastIndex = 0;
  for (let m = REF_ETIQUETA_GENERICA.exec(texto); m; m = REF_ETIQUETA_GENERICA.exec(texto)) {
    const antes = texto.slice(Math.max(0, m.index - 24), m.index);
    if (PISTAS_DE_CUENTA.test(antes)) continue;
    if (m[1]) return m[1].trim();
  }
  return "";
}

/**
 * Fecha del comprobante, en numero o con el mes escrito.
 *
 * Los bancos la escriben de las dos formas: «01/09/2026» y «05/sept/2026». Buscando solo la
 * numerica, los comprobantes del segundo grupo quedaban sin fecha y nunca se podian rechazar
 * por viejos.
 *
 * Se prefiere la que viene rotulada «Fecha» o «Realizado el»: en un comprobante puede haber
 * otras fechas —vencimientos, la del proximo pago— y la que importa es la de la operacion.
 */
const FECHA_NUMERICA = String.raw`\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}`;
const FECHA_CON_MES = String.raw`\d{1,2}\s*(?:de\s+)?[/.\- ]\s*[A-Za-zÁÉÍÓÚáéíóú.]{3,10}\s*(?:de\s+)?[/.\- ]\s*\d{2,4}`;
const CUALQUIER_FECHA = `(${FECHA_CON_MES}|${FECHA_NUMERICA})`;
const ETIQUETA_FECHA = String.raw`(?:fecha\s+y\s+hora|realizado\s+el|fecha)\s*[:\s.\-]*`;

export function extraerFechaDeComprobante(texto: string): string {
  const rotulada = texto.match(new RegExp(ETIQUETA_FECHA + CUALQUIER_FECHA, "i"));
  if (rotulada?.[1]) return rotulada[1].trim();

  const suelta = texto.match(new RegExp(CUALQUIER_FECHA, "i"));
  return suelta?.[1]?.trim() ?? "";
}

/** Heurística liviana para comprobantes PY / transferencias (no reemplaza revisión humana). */
export function extractReceiptFieldsFromOcr(
  fullText: string,
  montoOpts?: SelectReceiptMontoFromOcrOptions
): ExtractedReceiptFields {
  const t = fullText || "";

  const pick = selectReceiptMontoFromOcrText(t, montoOpts ?? {});

  const referencia = extraerReferenciaDeComprobante(t);

  const fecha = extraerFechaDeComprobante(t);

  let hora = "";
  const horaRe = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/;
  const hm = t.match(horaRe);
  if (hm?.[1]) hora = hm[1];

  let banco = "";
  const banks = [
    "itaú",
    "itau",
    "continental",
    "banco nacional",
    "sudameris",
    "gnb",
    "ueno",
    "basa",
    "familiar",
    "regional",
    "bancop",
    "visión",
    "vision",
    "atlas",
    "bbva",
    "interfisa",
    "amambay",
    "zeta",
  ];
  const tl = t.toLowerCase();
  for (const b of banks) {
    if (tl.includes(b)) {
      banco = b.replace(/\b\w/g, (c) => c.toUpperCase());
      break;
    }
  }

  return {
    monto: pick.monto,
    monto_ocr_audit: pick.audit,
    referencia,
    fecha,
    hora,
    banco,
    texto_completo: normalizeWs(t),
  };
}

function fieldValue(key: OcrFieldKey, extracted: ExtractedReceiptFields): string {
  return extracted[key]?.trim() ?? "";
}

function rankMissing(b: OnMissingBehavior): number {
  if (b === "bloquear") return 3;
  if (b === "revision_manual") return 2;
  return 1;
}

function worstMissing(a: OnMissingBehavior, b: OnMissingBehavior): OnMissingBehavior {
  return rankMissing(a) >= rankMissing(b) ? a : b;
}

async function existsHashDuplicate(
  supabase: AppSupabaseClient,
  empresaId: string,
  hash: string
): Promise<boolean> {
  if (!hash.trim()) return false;
  const { data, error } = await supabase
    .from("chat_comprobante_validaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("comprobante_hash", hash)
    .in("estado_validacion", ESTADOS_HASH_BLOQUEA_REUSO)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

async function existsOcrRefDuplicate(
  supabase: AppSupabaseClient,
  empresaId: string,
  refNorm: string,
  sameFlowSessionId: string
): Promise<boolean> {
  if (!refNorm) return false;
  const { data, error } = await supabase
    .from("chat_comprobante_validaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("ocr_referencia", refNorm)
    .eq("estado_validacion", "valido")
    .neq("flow_session_id", sameFlowSessionId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

/**
 * Igual que referencia: solo bloquea reuso entre **otras** sesiones de flujo (`flow_session_id`).
 * Antes se pasaba `flow_session_id` como `excludeId` pero se comparaba con `row.id` → la exclusión nunca aplicaba.
 */
async function existsOcrFingerprintDuplicate(
  supabase: AppSupabaseClient,
  empresaId: string,
  fp: string,
  sameFlowSessionId: string
): Promise<boolean> {
  if (!fp) return false;
  const { data, error } = await supabase
    .from("chat_comprobante_validaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("ocr_fingerprint", fp)
    .in("estado_validacion", ["valido", "revision_manual"])
    .neq("flow_session_id", sameFlowSessionId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

export type ComprobantePipelineResult =
  | { kind: "disabled" }
  | {
      kind: "resolved";
      validationId: string;
      estado: ComprobanteEstadoValidacion;
      motivo: string;
      flowUpserts: Array<{
        empresa_id: string;
        conversation_id: string;
        flow_code: string;
        flow_session_id: string;
        field_name: string;
        field_value: string;
      }>;
      advance: boolean;
      sendInteractive?: { body: string; buttons: { id: string; title: string }[] };
      sendText?: string;
      humanTakeover?: boolean;
    };

type PipelineCtx = {
  supabase: AppSupabaseClient;
  empresaId: string;
  conversationId: string;
  channelId: string;
  flowCode: string;
  flowSessionId: string;
  mediaId: string;
  publicUrl: string;
  bytes: Buffer;
  mimeType: string;
  settings: ComprobanteValidationSettings;
  /** El mensaje llegó reenviado de otro chat (`context.forwarded` de WhatsApp). */
  reenviado?: boolean;
  /**
   * Solo pruebas automatizadas: si se define, no se llama a Vision y se usa como texto OCR crudo.
   */
  ocrTextOverride?: string | null;
};

/**
 * Total esperado cuando el flujo no dejó ningún `monto` guardado.
 *
 * Es el mismo cálculo que hace el mensaje que se le manda al cliente —cantidad × precio del
 * sorteo—, así que valida contra la cifra que él vio y contra la que después se le cobra.
 * Devuelve null si no hay cantidad todavía o si el flujo no está atado a un sorteo: ahí la
 * validación se sigue salteando, como antes.
 */
async function calcularMontoEsperadoDesdeCantidad(
  supabase: AppSupabaseClient,
  empresaId: string,
  flowCode: string,
  flowSessionId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("chat_flow_data")
      .select("field_name, field_value")
      .eq("flow_session_id", flowSessionId)
      .in("field_name", ["cantidad", "cantidad_boletos"]);
    if (error) return null;

    const flowData: Record<string, string> = {};
    for (const row of (data ?? []) as { field_name?: string; field_value?: string }[]) {
      const k = (row.field_name ?? "").trim();
      if (k) flowData[k] = row.field_value ?? "";
    }

    const vars = await buildMontoCalculadoVars({ supabase, empresaId, flowCode, flowData });
    const total = Number(vars[MONTO_CALCULADO_KEYS.total] ?? "");
    return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
  } catch (e) {
    console.warn(
      "[sorteo-comprobante][monto-esperado] no_se_pudo_calcular",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

async function insertValidationRow(
  supabase: AppSupabaseClient,
  input: {
    empresa_id: string;
    conversation_id: string;
    flow_session_id: string;
    channel_id: string;
    flow_code: string;
    comprobante_url: string;
    comprobante_media_id: string;
    comprobante_hash: string;
    estado_validacion: ComprobanteEstadoValidacion;
    motivo_validacion: string;
    ocr_text_raw: string | null;
    ocr_monto: string | null;
    ocr_referencia: string | null;
    ocr_fecha: string | null;
    ocr_hora: string | null;
    ocr_banco: string | null;
    ocr_fingerprint: string | null;
    monto_validacion_esperado_gs?: number | null;
    monto_validacion_ocr_gs?: number | null;
    monto_validacion_diferencia_gs?: number | null;
    monto_validacion_status?: string | null;
    bank_val_titular_esperado?: string | null;
    bank_val_cuenta_esperada?: string | null;
    bank_val_alias_esperado?: string | null;
    bank_val_titular_ocr?: string | null;
    bank_val_cuenta_ocr?: string | null;
    bank_val_alias_ocr?: string | null;
    bank_val_coincidencias?: number | null;
    bank_val_min_requeridas?: number | null;
    bank_val_status?: string | null;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from("chat_comprobante_validaciones")
    .insert({
      ...input,
      monto_validacion_esperado_gs: input.monto_validacion_esperado_gs ?? null,
      monto_validacion_ocr_gs: input.monto_validacion_ocr_gs ?? null,
      monto_validacion_diferencia_gs: input.monto_validacion_diferencia_gs ?? null,
      monto_validacion_status: input.monto_validacion_status ?? null,
      bank_val_titular_esperado: input.bank_val_titular_esperado ?? null,
      bank_val_cuenta_esperada: input.bank_val_cuenta_esperada ?? null,
      bank_val_alias_esperado: input.bank_val_alias_esperado ?? null,
      bank_val_titular_ocr: input.bank_val_titular_ocr ?? null,
      bank_val_cuenta_ocr: input.bank_val_cuenta_ocr ?? null,
      bank_val_alias_ocr: input.bank_val_alias_ocr ?? null,
      bank_val_coincidencias: input.bank_val_coincidencias ?? null,
      bank_val_min_requeridas: input.bank_val_min_requeridas ?? null,
      bank_val_status: input.bank_val_status ?? null,
    })
    .select("id")
    .single();
  if (error) {
    const msg = error.message ?? "";
    if (/chat_comprobante_validaciones_channel_id_fkey/i.test(msg)) {
      console.error("[flow-comprobante-val][fk-channel_id]", {
        channel_id: input.channel_id,
        hint:
          "La FK de channel_id debe referenciar chat_channels del mismo schema tenant que chat_comprobante_validaciones. Si apunta a public o zentra_erp, ejecutá en SQL Editor: SELECT zentra_erp.neura_fix_foreign_keys_retarget_from_public('<tu_schema>'); o la migración 20260527120000_fix_tenant_chat_comprobante_validaciones_channel_fk.sql",
      });
    }
    throw new Error(msg);
  }
  const id = (data as { id?: string })?.id;
  if (!id) throw new Error("No se pudo crear registro de validación");
  return id;
}

export async function runComprobanteValidationPipeline(ctx: PipelineCtx): Promise<ComprobantePipelineResult> {
  const { supabase, settings } = ctx;
  if (!settings.enabled) {
    return { kind: "disabled" };
  }

  const hash = sha256Hex(ctx.bytes);
  const fc = ctx.flowCode.trim();
  const sid = ctx.flowSessionId.trim();

  type FlowUpsertRow = {
    empresa_id: string;
    conversation_id: string;
    flow_code: string;
    flow_session_id: string;
    field_name: string;
    field_value: string;
  };

  const baseUpserts = (extra: Array<[string, string]>): FlowUpsertRow[] => {
    const pairs: Array<[string, string]> = [
      [SORTEO_COMPROBANTE_URL_FIELD, ctx.publicUrl],
      [SORTEO_COMPROBANTE_MEDIA_ID_FIELD, ctx.mediaId],
      [SORTEO_COMPROBANTE_HASH_FIELD, hash],
      ...extra,
    ];
    return pairs.map(([field_name, field_value]) => ({
      empresa_id: ctx.empresaId,
      conversation_id: ctx.conversationId,
      flow_code: fc,
      flow_session_id: sid,
      field_name,
      field_value,
    }));
  };

  // --- Hash duplicado ---
  if (settings.deteccion_duplicados_hash && settings.bloquear_por_hash_duplicado) {
    const dup = await existsHashDuplicate(supabase, ctx.empresaId, hash);
    if (dup) {
      console.info("[sorteo-comprobante][duplicate-check]", {
        empresa_id: ctx.empresaId,
        conversation_id: ctx.conversationId,
        flow_session_id: sid,
        media_id_present: Boolean(ctx.mediaId?.trim()),
        hash_prefix: hash.slice(0, 12),
        duplicate_decision: "block_hash",
        duplicate_match_type: "comprobante_hash",
        confidence: "high",
        reason: "hash_ya_en_bd_estado_bloqueante",
      });
      const validationId = await insertValidationRow(supabase, {
        empresa_id: ctx.empresaId,
        conversation_id: ctx.conversationId,
        flow_session_id: sid,
        channel_id: ctx.channelId,
        flow_code: fc,
        comprobante_url: ctx.publicUrl,
        comprobante_media_id: ctx.mediaId,
        comprobante_hash: hash,
        estado_validacion: "duplicado_hash",
        motivo_validacion: "hash_duplicado_empresa",
        ocr_text_raw: null,
        ocr_monto: null,
        ocr_referencia: null,
        ocr_fecha: null,
        ocr_hora: null,
        ocr_banco: null,
        ocr_fingerprint: null,
      });
      return {
        kind: "resolved",
        validationId,
        estado: "duplicado_hash",
        motivo: "hash_duplicado_empresa",
        flowUpserts: baseUpserts([
          [SORTEO_COMPROBANTE_VALIDACION_ID_FIELD, validationId],
          [SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD, "duplicado_hash"],
          [SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD, "hash_duplicado_empresa"],
        ]),
        advance: false,
        sendInteractive: {
          body: settings.messages.hash_duplicado,
          buttons: [
            { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
            {
              id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
              title: settings.messages.boton_asesor_titulo.slice(0, 20),
            },
          ],
        },
      };
    }
  }

  /**
   * OCR. Los PDF pasan por acá igual que las imágenes: `runGoogleVisionDocumentOcr` los manda
   * al endpoint de documentos de Vision. Antes se los salteaba a propósito —cuando el OCR solo
   * sabía leer imágenes— y todo comprobante en PDF terminaba en revisión manual, que es lo que
   * el cliente reportó: manda el PDF del homebanking y no le sale la boleta.
   */
  let fullText = "";
  let ocrFailedReason: string | null = null;

  if (ctx.ocrTextOverride !== undefined && ctx.ocrTextOverride !== null) {
    fullText = ctx.ocrTextOverride;
  } else {
    try {
      const r = await runGoogleVisionDocumentOcr(ctx.bytes, ctx.mimeType);
      fullText = r.fullText;
    } catch (e) {
      ocrFailedReason = e instanceof Error ? e.message : "ocr_error";
    }
  }

  const ocrInsuficiente = !fullText.trim() || Boolean(ocrFailedReason);

  if (settings.ocr_obligatorio && ocrInsuficiente) {
    const motivo = ocrFailedReason ?? "ocr_vacio";
    const behavior = settings.ocr_fallo_comportamiento;
    const estadoInsert: ComprobanteEstadoValidacion =
      behavior === "bloquear" ? "ocr_error" : behavior === "revision_manual" ? "revision_manual" : "valido";

    const validationId = await insertValidationRow(supabase, {
      empresa_id: ctx.empresaId,
      conversation_id: ctx.conversationId,
      flow_session_id: sid,
      channel_id: ctx.channelId,
      flow_code: fc,
      comprobante_url: ctx.publicUrl,
      comprobante_media_id: ctx.mediaId,
      comprobante_hash: hash,
      estado_validacion: estadoInsert,
      motivo_validacion: motivo,
      ocr_text_raw: fullText || null,
      ocr_monto: null,
      ocr_referencia: null,
      ocr_fecha: null,
      ocr_hora: null,
      ocr_banco: null,
      ocr_fingerprint: null,
    });

    const estado: ComprobanteEstadoValidacion = estadoInsert;

    const ups = baseUpserts([
      [SORTEO_COMPROBANTE_VALIDACION_ID_FIELD, validationId],
      [SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD, estado],
      [SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD, motivo],
      [SORTEO_COMPROBANTE_OCR_TEXT_FIELD, fullText],
    ]);

    if (behavior === "bloquear") {
      return {
        kind: "resolved",
        validationId,
        estado,
        motivo,
        flowUpserts: ups,
        advance: false,
        sendInteractive: {
          body: settings.messages.ocr_insuficiente,
          buttons: [
            { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
            {
              id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
              title: settings.messages.boton_asesor_titulo.slice(0, 20),
            },
          ],
        },
      };
    }
    if (behavior === "revision_manual") {
      const takeover = settings.revision_manual_activar_takeover;
      return {
        kind: "resolved",
        validationId,
        estado,
        motivo,
        flowUpserts: ups,
        advance: !takeover,
        sendText: settings.messages.revision_manual,
        humanTakeover: takeover,
      };
    }
    // continuar sin OCR útil: marcamos válido para no frenar operación (config explícita)
    return {
      kind: "resolved",
      validationId,
      estado: "valido",
      motivo: "ocr_omitido_continuar",
      flowUpserts: ups,
      advance: true,
    };
  }

  // OCR no obligatorio pero insuficiente: seguir con texto vacío (puede disparar reglas por campo).
  if (!fullText.trim() && !settings.ocr_obligatorio && ocrInsuficiente) {
    fullText = "";
  }

  const mfPrior =
    settings.monto_fields_prioridad.length > 0
      ? settings.monto_fields_prioridad
      : [...DEFAULT_MONTO_FIELDS_PRIORIDAD];

  let precalcEsperadoGs: number | null | undefined = undefined;
  if (settings.validar_monto_vs_flujo) {
    precalcEsperadoGs = await fetchExpectedMontoGsFromFlowSession(supabase, sid, mfPrior);
    if (precalcEsperadoGs == null) {
      /*
       * Cuando la cantidad se pide por texto («respondé con el número») no queda ningún campo
       * `monto` guardado: el total se calcula al vuelo para mostrarlo en el mensaje y no se
       * escribe en `chat_flow_data`. Sin monto esperado esta validación se saltaba en silencio,
       * y un comprobante por menos plata de la que corresponde pasaba como válido.
       *
       * Se recalcula igual que lo hace el mensaje: cantidad × precio del sorteo, que es
       * exactamente lo que despues cobra la orden cuando no hay promo. Un monto de promo ya
       * guardado sigue teniendo prioridad, porque en ese caso el paso anterior lo encuentra.
       */
      precalcEsperadoGs = await calcularMontoEsperadoDesdeCantidad(supabase, ctx.empresaId, fc, sid);
    }
  }

  const montoOpts: SelectReceiptMontoFromOcrOptions = {
    datosBancariosEsperados: settings.datos_bancarios_esperados,
    toleranciaAbsolutaGs: settings.monto_tolerancia_absoluta_gs,
    ...(precalcEsperadoGs !== undefined ? { expectedMontoGs: precalcEsperadoGs } : {}),
  };

  const extracted = extractReceiptFieldsFromOcr(fullText, montoOpts);

  const montoFlowResult = await validateReceiptAmountAgainstFlow(supabase, {
    flowSessionId: sid,
    validar_monto_vs_flujo: settings.validar_monto_vs_flujo,
    monto_tolerancia_absoluta_gs: settings.monto_tolerancia_absoluta_gs,
    monto_fields_prioridad: mfPrior,
    extractedMontoString: extracted.monto,
    precalcEsperadoGs,
    montoOcrSelectionAudit: extracted.monto_ocr_audit ?? null,
  });

  if (settings.validar_monto_vs_flujo && extracted.monto_ocr_audit) {
    console.info("[sorteo-comprobante][monto-ocr-pick]", {
      empresa_id: ctx.empresaId,
      conversation_id: ctx.conversationId.slice(0, 8) + "…",
      flow_session_id: sid.slice(0, 8) + "…",
      pick_reason: extracted.monto_ocr_audit.chosen_reason,
      n_candidates: extracted.monto_ocr_audit.candidates.length,
      n_discarded_bank: extracted.monto_ocr_audit.discarded_bank_match.length,
    });
  }

  const bankFlowResult = validateReceiptBankDataAgainstExpected(settings, fullText);

  /*
   * Fecha del comprobante. Alguien puede mandar la captura de una transferencia vieja: existió
   * de verdad y el OCR la lee perfecto, así que la fecha es lo único que la delata.
   *
   * Si no se pudo leer, no se rechaza. Dejar pasar un comprobante viejo lo nota alguien; en
   * cambio rechazar el pago bueno de un cliente por una fecha mal leída lo hace irse.
   */
  const fechaEval = evaluarFechaComprobante({
    fechaOcr: extracted.fecha,
    maxDiasAntiguedad: settings.max_dias_antiguedad_comprobante,
  });
  if (fechaEval.fueraDeVentana) {
    console.info("[sorteo-comprobante][fecha]", {
      empresa_id: ctx.empresaId,
      flow_session_id: sid,
      ocr_fecha: extracted.fecha,
      dias: fechaEval.diasDeAntiguedad,
      motivo: fechaEval.motivo,
      max_dias: settings.max_dias_antiguedad_comprobante,
    });
  }

  const fpLongEnough =
    extracted.texto_completo.length >= MIN_CHARS_FOR_OCR_FINGERPRINT_CHECK;
  const fp =
    settings.ocr_fields.texto_completo.use_duplicate_detection &&
    fpLongEnough &&
    extracted.texto_completo
      ? ocrFingerprint(extracted.texto_completo)
      : null;

  const refStored = extracted.referencia.trim().toUpperCase() || null;
  let refForDup = ocrReferenceUsableForStrongDuplicate(refStored);
  if (refForDup && ocrReferenciaMatchesConfiguredMerchantIdentifiers(refStored, settings.datos_bancarios_esperados)) {
    console.info("[sorteo-comprobante][ocr-reference-ignored]", {
      reason: "matches_expected_bank_account",
      empresa_id: ctx.empresaId,
      conversation_id: ctx.conversationId,
      flow_session_id: sid,
      ocr_ref_masked: maskComprobanteRefForLog(refStored),
    });
    refForDup = null;
  }

  let ocrRefStrongDup = false;
  let ocrFingerprintWeakDup = false;
  if (settings.bloquear_por_ocr_duplicado) {
    if (settings.ocr_fields.referencia.use_duplicate_detection && refForDup) {
      ocrRefStrongDup = await existsOcrRefDuplicate(supabase, ctx.empresaId, refForDup, sid);
    }
    if (
      !ocrRefStrongDup &&
      settings.ocr_fields.texto_completo.use_duplicate_detection &&
      fp
    ) {
      ocrFingerprintWeakDup = await existsOcrFingerprintDuplicate(supabase, ctx.empresaId, fp, sid);
    }
  }

  let dupDecision: "none" | "block_strong_ref" | "weak_fingerprint_revision" = "none";
  if (ocrRefStrongDup) dupDecision = "block_strong_ref";
  else if (ocrFingerprintWeakDup) dupDecision = "weak_fingerprint_revision";

  console.info("[sorteo-comprobante][duplicate-check]", {
    empresa_id: ctx.empresaId,
    conversation_id: ctx.conversationId,
    flow_session_id: sid,
    media_id_present: Boolean(ctx.mediaId?.trim()),
    hash_prefix: hash.slice(0, 12),
    ocr_present: fullText.trim().length > 0,
    normalized_fields_present: {
      ref: Boolean(refStored),
      ref_eligible_strong_dup: Boolean(refForDup),
      monto: Boolean(extracted.monto),
      fecha: Boolean(extracted.fecha),
    },
    duplicate_decision: dupDecision,
    duplicate_match_type: ocrRefStrongDup
      ? "ocr_referencia"
      : ocrFingerprintWeakDup
        ? "ocr_fingerprint_debil"
        : null,
    confidence: ocrRefStrongDup ? "high" : ocrFingerprintWeakDup ? "low" : null,
    reason: dupDecision,
    ocr_ref_masked: maskComprobanteRefForLog(refStored),
  });

  // --- Reglas campos analizados / obligatorios ---
  let missingWorst: OnMissingBehavior = "continuar";
  const missingParts: string[] = [];
  const keys: OcrFieldKey[] = ["monto", "referencia", "fecha", "hora", "banco", "texto_completo"];
  for (const key of keys) {
    const rule = settings.ocr_fields[key];
    if (!rule.analyzed) continue;
    const val = fieldValue(key, extracted);
    if (!val && rule.required) {
      missingWorst = worstMissing(missingWorst, rule.on_missing);
      missingParts.push(key);
    }
  }

  // --- Sospecha heurística (solo si hubo texto OCR; si OCR es opcional y vino vacío, no forzar revisión por longitud) ---
  const sospecha =
    settings.revision_manual_si_sospecha_ocr &&
    settings.ocr_obligatorio &&
    fullText.length > 0 &&
    fullText.length < settings.ocr_min_chars_sospecha;

  // Resolver prioridad: duplicado OCR fuerte > huella débil (revisión) > missing bloquear > missing revision > sospecha > válido
  let estado: ComprobanteEstadoValidacion = "valido";
  let motivo = "ok";

  if (ctx.reenviado && settings.rechazar_comprobante_reenviado) {
    /*
     * Va primero, antes que cualquier otra regla: un comprobante reenviado no prueba nada,
     * por mas que el OCR lo lea perfecto y los datos bancarios coincidan. Es la captura de
     * otra persona, o la de una compra anterior que ya se uso.
     */
    estado = "comprobante_reenviado";
    motivo = "mensaje_reenviado";
  } else if (fechaEval.fueraDeVentana) {
    estado = "comprobante_vencido";
    motivo = `fecha_comprobante:${fechaEval.motivo};ocr=${extracted.fecha};dias=${fechaEval.diasDeAntiguedad}`;
  } else if (ocrRefStrongDup) {
    estado = "duplicado_ocr";
    motivo = "ocr_duplicado_referencia";
  } else if (ocrFingerprintWeakDup) {
    estado = "revision_manual";
    motivo = MOTIVO_REVISION_HUELLA_OCR_DEBIL;
  } else if (missingWorst === "bloquear") {
    estado = "ocr_error";
    motivo = `campo_obligatorio:${missingParts.join(",")}`;
  } else if (missingWorst === "revision_manual") {
    estado = "revision_manual";
    motivo = `campo_faltante_revision:${missingParts.join(",")}`;
  } else if (montoFlowResult.apply && !montoFlowResult.ok) {
    estado = "monto_incoherente";
    const a = montoFlowResult.audit;
    const ocrPick =
      a.monto_ocr_candidates_compact && a.monto_ocr_candidates_compact.length > 0
        ? `|${a.monto_ocr_candidates_compact}`.slice(0, 520)
        : "";
    motivo =
      `monto_vs_flujo:esperado=${a.monto_validacion_esperado_gs};ocr=${a.monto_validacion_ocr_gs};diff=${a.monto_validacion_diferencia_gs}` +
      ocrPick;
  } else if (bankFlowResult.apply && !bankFlowResult.ok) {
    estado = "datos_bancarios_incoherentes";
    motivo = bankFlowResult.motivoDetalle ?? "datos_bancarios:discrepancia";
  } else if (sospecha) {
    estado = "revision_manual";
    motivo = "ocr_texto_corto_sospecha";
  }

  const validationId = await insertValidationRow(supabase, {
    empresa_id: ctx.empresaId,
    conversation_id: ctx.conversationId,
    flow_session_id: sid,
    channel_id: ctx.channelId,
    flow_code: fc,
    comprobante_url: ctx.publicUrl,
    comprobante_media_id: ctx.mediaId,
    comprobante_hash: hash,
    estado_validacion: estado,
    motivo_validacion: motivo,
    ocr_text_raw: fullText || null,
    ocr_monto: extracted.monto || null,
    ocr_referencia: refStored,
    ocr_fecha: extracted.fecha || null,
    ocr_hora: extracted.hora || null,
    ocr_banco: extracted.banco || null,
    ocr_fingerprint: fp,
    monto_validacion_esperado_gs: montoFlowResult.audit.monto_validacion_esperado_gs,
    monto_validacion_ocr_gs: montoFlowResult.audit.monto_validacion_ocr_gs,
    monto_validacion_diferencia_gs: montoFlowResult.audit.monto_validacion_diferencia_gs,
    monto_validacion_status: montoFlowResult.audit.monto_validacion_status,
    bank_val_titular_esperado: bankFlowResult.audit.bank_val_titular_esperado,
    bank_val_cuenta_esperada: bankFlowResult.audit.bank_val_cuenta_esperada,
    bank_val_alias_esperado: bankFlowResult.audit.bank_val_alias_esperado,
    bank_val_titular_ocr: bankFlowResult.audit.bank_val_titular_ocr,
    bank_val_cuenta_ocr: bankFlowResult.audit.bank_val_cuenta_ocr,
    bank_val_alias_ocr: bankFlowResult.audit.bank_val_alias_ocr,
    bank_val_coincidencias: bankFlowResult.audit.bank_val_coincidencias,
    bank_val_min_requeridas: bankFlowResult.audit.bank_val_min_requeridas,
    bank_val_status: bankFlowResult.audit.bank_val_status,
  });

  const flowUpserts = baseUpserts([
    [SORTEO_COMPROBANTE_VALIDACION_ID_FIELD, validationId],
    [SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD, estado],
    [SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD, motivo],
    [SORTEO_COMPROBANTE_OCR_TEXT_FIELD, fullText],
    [SORTEO_COMPROBANTE_OCR_MONTO_FIELD, extracted.monto],
    [SORTEO_COMPROBANTE_OCR_REF_FIELD, extracted.referencia],
    [SORTEO_COMPROBANTE_OCR_FECHA_FIELD, extracted.fecha],
    [SORTEO_COMPROBANTE_OCR_HORA_FIELD, extracted.hora],
    [SORTEO_COMPROBANTE_OCR_BANCO_FIELD, extracted.banco],
  ]);

  if (estado === "duplicado_ocr") {
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      advance: false,
      sendInteractive: {
        body: settings.messages.ocr_duplicado,
        buttons: [
          { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
          {
            id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
            title: settings.messages.boton_asesor_titulo.slice(0, 20),
          },
        ],
      },
    };
  }

  if (estado === "comprobante_vencido") {
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      advance: false,
      sendInteractive: {
        body: settings.messages.comprobante_vencido,
        buttons: [
          { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
          {
            id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
            title: settings.messages.boton_asesor_titulo.slice(0, 20),
          },
        ],
      },
    };
  }

  if (estado === "comprobante_reenviado") {
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      advance: false,
      sendInteractive: {
        body: settings.messages.comprobante_reenviado,
        buttons: [
          { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
          {
            id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
            title: settings.messages.boton_asesor_titulo.slice(0, 20),
          },
        ],
      },
    };
  }

  if (estado === "monto_incoherente") {
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      advance: false,
      sendInteractive: {
        body: settings.messages.monto_incoherente,
        buttons: [
          { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
          {
            id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
            title: settings.messages.boton_asesor_titulo.slice(0, 20),
          },
        ],
      },
    };
  }

  if (estado === "datos_bancarios_incoherentes") {
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      advance: false,
      sendInteractive: {
        body: settings.messages.datos_bancarios_incoherentes,
        buttons: [
          { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
          {
            id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
            title: settings.messages.boton_asesor_titulo.slice(0, 20),
          },
        ],
      },
    };
  }

  if (estado === "ocr_error" && missingWorst === "bloquear") {
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      advance: false,
      sendInteractive: {
        body: settings.messages.ocr_insuficiente,
        buttons: [
          { id: COMPROBANTE_BUTTON_IDS.enviar_otro, title: settings.messages.boton_otro_titulo.slice(0, 20) },
          {
            id: COMPROBANTE_BUTTON_IDS.hablar_asesor,
            title: settings.messages.boton_asesor_titulo.slice(0, 20),
          },
        ],
      },
    };
  }

  if (estado === "revision_manual") {
    const takeover = settings.revision_manual_activar_takeover;
    const manualText =
      motivo === MOTIVO_REVISION_HUELLA_OCR_DEBIL
        ? settings.messages.ocr_coincidencia_debil
        : settings.messages.revision_manual;
    return {
      kind: "resolved",
      validationId,
      estado,
      motivo,
      flowUpserts,
      // Con takeover el bot no debe avanzar el flujo: queda a cargo del operador humano.
      advance: !takeover,
      sendText: manualText,
      humanTakeover: takeover,
    };
  }

  return {
    kind: "resolved",
    validationId,
    estado,
    motivo,
    flowUpserts,
    advance: true,
  };
}

const DEFAULT_MSG_COMPROBANTE_NO_CIERRA =
  "Todavía no podemos cerrar esta compra: el comprobante debe estar validado. Si ya enviaste uno, esperá la revisión o contactá a un asesor.";

/** Mensaje al cliente cuando toca Confirmar pero `estado_validacion` ≠ valido. */
export async function mensajeClienteComprobanteNoValido(
  supabase: AppSupabaseClient,
  conversationId: string,
  estado: string,
  motivoValidacion?: string | null
): Promise<string> {
  const { data: conv, error } = await supabase
    .from("chat_conversations")
    .select("channel_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !conv?.channel_id) return DEFAULT_MSG_COMPROBANTE_NO_CIERRA;
  const { data: ch } = await supabase
    .from("chat_channels")
    .select("config")
    .eq("id", conv.channel_id as string)
    .maybeSingle();
  const s = parseComprobanteValidationConfig(ch?.config);
  if (estado === "revision_manual") {
    const m = (motivoValidacion ?? "").trim();
    if (m === MOTIVO_REVISION_HUELLA_OCR_DEBIL || m.startsWith("ocr_huella_similar")) {
      return s.messages.ocr_coincidencia_debil;
    }
    return s.messages.revision_manual;
  }
  if (estado === "duplicado_hash") return s.messages.hash_duplicado;
  if (estado === "duplicado_ocr") return s.messages.ocr_duplicado;
  if (estado === "comprobante_reenviado") return s.messages.comprobante_reenviado;
  if (estado === "comprobante_vencido") return s.messages.comprobante_vencido;
  if (estado === "monto_incoherente") return s.messages.monto_incoherente;
  if (estado === "datos_bancarios_incoherentes") return s.messages.datos_bancarios_incoherentes;
  if (estado === "ocr_error") return s.messages.ocr_insuficiente;
  return DEFAULT_MSG_COMPROBANTE_NO_CIERRA;
}
