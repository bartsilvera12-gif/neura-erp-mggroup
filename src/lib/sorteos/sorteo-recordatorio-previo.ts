import "server-only";

import { randomUUID } from "node:crypto";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { runCampaignProcessOnce } from "@/lib/campaigns/campaign-job-service";
import { extractBodyPlaceholderKeysOrdered } from "@/lib/campaigns/campaign-placeholders-shared";
import { normalizeCampaignPhone } from "@/lib/campaigns/campaign-phone";
import { templateSnapshotHasHeaderImage } from "@/lib/campaigns/campaign-header-image";
import type { SupabaseAdmin } from "@/lib/chat/types";

/**
 * Aviso previo al sorteo.
 *
 * Un día antes (configurable) de `sorteos.fecha_sorteo` se arma una campaña de WhatsApp
 * dirigida a los participantes que ya pagaron y se lanza sola. Fuera de la ventana de 24 h
 * WhatsApp solo acepta plantillas aprobadas, así que el sorteo tiene que tener una elegida.
 *
 * Idempotencia: `recordatorio_previo_sent_at` se marca al crear la campaña; si el cron
 * vuelve a correr el mismo día, el sorteo ya no aparece como pendiente.
 */

export const RECORDATORIO_MAX_RECIPIENTS = 5000;
/** Tope de mensajes que un solo pasaje del cron intenta despachar (evita timeouts). */
export const RECORDATORIO_MAX_SEND_PER_RUN = 200;
const PROCESS_BATCH_SIZE = 25;

export type SorteoRecordatorioSkip = {
  sorteo_id: string;
  sorteo_nombre: string;
  reason: string;
};

export type SorteoRecordatorioCreated = {
  sorteo_id: string;
  sorteo_nombre: string;
  campaign_id: string;
  destinatarios: number;
  invalidos: number;
};

export type SorteoRecordatorioRunResult = {
  empresa_id: string;
  fecha_py: string;
  creados: SorteoRecordatorioCreated[];
  omitidos: SorteoRecordatorioSkip[];
  despachados: number;
  dry_run: boolean;
};

type SorteoRow = {
  id: string;
  nombre: string | null;
  fecha_sorteo: string | null;
  estado: string | null;
  recordatorio_previo_enabled: boolean | null;
  recordatorio_previo_dias_antes: number | null;
  recordatorio_previo_template_id: string | null;
  recordatorio_previo_sent_at: string | null;
};

type TemplateRow = {
  id: string;
  channel_id: string;
  provider: string;
  name: string;
  language: string | null;
  category: string | null;
  status: string;
  components_json: unknown;
};

type EntradaRow = {
  id: string;
  whatsapp_numero: string | null;
  nombre_participante: string | null;
  chat_conversation_id: string | null;
};

/** Fecha calendario en Paraguay (el cron corre en UTC; sin esto el aviso se adelanta o atrasa un día). */
export function fechaEnParaguay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Suma días a una fecha `YYYY-MM-DD` sin arrastrar husos horarios. */
export function sumarDias(fechaIso: string, dias: number): string {
  const [y, m, d] = fechaIso.split("-").map((n) => parseInt(n, 10));
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}

/**
 * ¿Al sorteo le toca el aviso hoy? Con `dias_antes = 1` y fecha de sorteo el 17,
 * el aviso sale el 16.
 */
export function tocaAvisarHoy(sorteo: SorteoRow, hoyPy: string): boolean {
  const fecha = (sorteo.fecha_sorteo ?? "").slice(0, 10);
  if (!fecha) return false;
  const dias = Math.max(0, Math.trunc(sorteo.recordatorio_previo_dias_antes ?? 1));
  return sumarDias(hoyPy, dias) === fecha;
}

function nombreCampana(sorteoNombre: string, fecha: string): string {
  return `Aviso previo — ${sorteoNombre} (${fecha})`.slice(0, 180);
}

export async function runSorteoRecordatoriosOnce(params: {
  empresaId: string;
  now?: Date;
  dryRun?: boolean;
  maxSendPerRun?: number;
}): Promise<SorteoRecordatorioRunResult> {
  const { empresaId } = params;
  const now = params.now ?? new Date();
  const dryRun = params.dryRun === true;
  const maxSend = Math.max(0, params.maxSendPerRun ?? RECORDATORIO_MAX_SEND_PER_RUN);
  const hoyPy = fechaEnParaguay(now);

  const sb = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;

  const creados: SorteoRecordatorioCreated[] = [];
  const omitidos: SorteoRecordatorioSkip[] = [];

  const { data: sorteosRaw, error: sErr } = await sb
    .from("sorteos")
    .select(
      "id, nombre, fecha_sorteo, estado, recordatorio_previo_enabled, recordatorio_previo_dias_antes, recordatorio_previo_template_id, recordatorio_previo_sent_at"
    )
    .eq("empresa_id", empresaId)
    .eq("recordatorio_previo_enabled", true)
    .is("recordatorio_previo_sent_at", null);
  if (sErr) throw new Error(`lookup sorteos: ${sErr.message}`);

  const pendientes = ((sorteosRaw ?? []) as SorteoRow[]).filter((s) => tocaAvisarHoy(s, hoyPy));

  for (const sorteo of pendientes) {
    const nombre = (sorteo.nombre ?? "").trim() || "Sorteo";
    try {
      const created = await crearYLanzarAviso({ sb, empresaId, sorteo, nombre, hoyPy, dryRun });
      if ("skip" in created) {
        omitidos.push({ sorteo_id: sorteo.id, sorteo_nombre: nombre, reason: created.skip });
      } else {
        creados.push(created.ok);
      }
    } catch (e) {
      omitidos.push({
        sorteo_id: sorteo.id,
        sorteo_nombre: nombre,
        reason: e instanceof Error ? e.message : "error desconocido",
      });
    }
  }

  const despachados = dryRun ? 0 : await despacharAvisosEnCurso({ sb, empresaId, maxSend });

  return { empresa_id: empresaId, fecha_py: hoyPy, creados, omitidos, despachados, dry_run: dryRun };
}

async function crearYLanzarAviso(args: {
  sb: SupabaseAdmin;
  empresaId: string;
  sorteo: SorteoRow;
  nombre: string;
  hoyPy: string;
  dryRun: boolean;
}): Promise<{ ok: SorteoRecordatorioCreated } | { skip: string }> {
  const { sb, empresaId, sorteo, nombre, hoyPy, dryRun } = args;

  const templateId = (sorteo.recordatorio_previo_template_id ?? "").trim();
  if (!templateId) return { skip: "el sorteo no tiene plantilla de aviso configurada" };

  const { data: tplRaw, error: tErr } = await sb
    .from("chat_campaign_templates")
    .select("id, channel_id, provider, name, language, category, status, components_json")
    .eq("empresa_id", empresaId)
    .eq("id", templateId)
    .maybeSingle();
  if (tErr) return { skip: `lookup plantilla: ${tErr.message}` };
  const template = tplRaw as TemplateRow | null;
  if (!template) return { skip: "la plantilla configurada ya no existe" };
  if (String(template.status).toUpperCase() !== "APPROVED") {
    return { skip: `la plantilla «${template.name}» no está aprobada por Meta` };
  }

  const componentsJson = Array.isArray(template.components_json) ? template.components_json : [];
  if (templateSnapshotHasHeaderImage(componentsJson)) {
    /** El aviso automático no tiene de dónde sacar la imagen de cabecera. */
    return { skip: `la plantilla «${template.name}» exige imagen de cabecera; usá una sin header de imagen` };
  }

  const { data: chRaw, error: chErr } = await sb
    .from("chat_channels")
    .select("id, type, provider, activo")
    .eq("empresa_id", empresaId)
    .eq("id", template.channel_id)
    .maybeSingle();
  if (chErr) return { skip: `lookup canal: ${chErr.message}` };
  const channel = chRaw as { activo?: boolean; type?: string } | null;
  if (!channel || channel.activo !== true || String(channel.type) !== "whatsapp") {
    return { skip: "el canal de WhatsApp de la plantilla no está activo" };
  }

  const audiencia = await cargarAudiencia({ sb, empresaId, sorteoId: sorteo.id });
  if (audiencia.length === 0) return { skip: "no hay participantes con pago confirmado" };

  if (dryRun) {
    return {
      ok: {
        sorteo_id: sorteo.id,
        sorteo_nombre: nombre,
        campaign_id: "(dry_run)",
        destinatarios: audiencia.length,
        invalidos: 0,
      },
    };
  }

  const placeholders = extractBodyPlaceholderKeysOrdered(componentsJson);
  const primerPlaceholder = placeholders[0] ?? null;

  const { data: campIns, error: campErr } = await sb
    .from("chat_campaigns")
    .insert({
      empresa_id: empresaId,
      name: nombreCampana(nombre, hoyPy),
      channel_id: template.channel_id,
      queue_id: null,
      provider: template.provider,
      template_id: template.id,
      template_name: template.name,
      template_language: template.language || "es",
      template_category: template.category ?? null,
      template_components_json: componentsJson,
      variable_mapping_json: primerPlaceholder ? { [primerPlaceholder]: "contact_name" } : {},
      send_config_json: {
        source: {
          kind: "sorteo_recordatorio_previo",
          sorteo_id: sorteo.id,
          sorteo_nombre: nombre,
          fecha_sorteo: sorteo.fecha_sorteo,
          dias_antes: sorteo.recordatorio_previo_dias_antes ?? 1,
          created_at: new Date().toISOString(),
        },
      },
      status: "draft",
      total_count: audiencia.length,
      valid_count: audiencia.length,
      invalid_count: 0,
      pending_count: audiencia.length,
      created_by: null,
    })
    .select("id")
    .single();
  if (campErr || !campIns) return { skip: `no se pudo crear la campaña: ${campErr?.message ?? "vacío"}` };
  const campaignId = String((campIns as { id: string }).id);

  await sb.from("chat_campaign_events").insert({
    empresa_id: empresaId,
    campaign_id: campaignId,
    recipient_id: null,
    event_type: "created",
    event_payload_json: { source: "sorteo_recordatorio_previo", sorteo_id: sorteo.id },
  });

  const ts = new Date().toISOString();
  let rowNum = 1;
  let validCount = 0;
  let invalidCount = 0;
  const BATCH = 200;
  for (let i = 0; i < audiencia.length; i += BATCH) {
    const rows = audiencia.slice(i, i + BATCH).map((a) => {
      const norm = normalizeCampaignPhone(a.telefono);
      const rowNumber = rowNum++;
      if (norm.ok) validCount++;
      else invalidCount++;
      const mapped: Record<string, string> = {};
      if (primerPlaceholder != null) mapped[primerPlaceholder] = a.nombre || "amigo/a";
      return {
        empresa_id: empresaId,
        campaign_id: campaignId,
        row_number: rowNumber,
        phone_raw: a.telefono || null,
        phone_e164: norm.ok ? norm.e164 : `invalid_${rowNumber}_${campaignId.slice(0, 8)}`,
        contact_id: null,
        conversation_id: a.conversationId,
        row_payload_json: {
          sorteo_id: sorteo.id,
          sorteo_nombre: nombre,
          entrada_id: a.entradaId,
          contact_name: a.nombre || null,
        },
        mapped_variables_json: mapped,
        status: norm.ok ? "pending" : "invalid",
        validation_error: norm.ok ? null : "Teléfono inválido",
        created_at: ts,
        updated_at: ts,
      };
    });
    const { error: recErr } = await sb.from("chat_campaign_recipients").insert(rows);
    if (recErr) return { skip: `no se pudieron cargar los destinatarios: ${recErr.message}` };
  }

  if (validCount === 0) {
    await sb
      .from("chat_campaigns")
      .update({ status: "cancelled", updated_at: ts })
      .eq("id", campaignId)
      .eq("empresa_id", empresaId);
    await marcarEnviado({ sb, empresaId, sorteoId: sorteo.id, campaignId });
    return { skip: "ningún participante tiene un teléfono válido" };
  }

  /** Lanzar: mismo camino que el botón «Enviar» del panel de campañas. */
  await sb
    .from("chat_campaign_recipients")
    .update({ status: "queued", updated_at: ts })
    .eq("empresa_id", empresaId)
    .eq("campaign_id", campaignId)
    .eq("status", "pending");
  await sb
    .from("chat_campaigns")
    .update({
      status: "sending",
      total_count: audiencia.length,
      valid_count: validCount,
      invalid_count: invalidCount,
      pending_count: validCount,
      updated_at: ts,
    })
    .eq("id", campaignId)
    .eq("empresa_id", empresaId);
  await sb.from("chat_campaign_events").insert({
    empresa_id: empresaId,
    campaign_id: campaignId,
    recipient_id: null,
    event_type: "launched",
    event_payload_json: {
      source: "sorteo_recordatorio_previo",
      sorteo_id: sorteo.id,
      valid: validCount,
      invalid: invalidCount,
    },
  });

  await marcarEnviado({ sb, empresaId, sorteoId: sorteo.id, campaignId });

  return {
    ok: {
      sorteo_id: sorteo.id,
      sorteo_nombre: nombre,
      campaign_id: campaignId,
      destinatarios: validCount,
      invalidos: invalidCount,
    },
  };
}

async function marcarEnviado(args: {
  sb: SupabaseAdmin;
  empresaId: string;
  sorteoId: string;
  campaignId: string;
}) {
  await args.sb
    .from("sorteos")
    .update({
      recordatorio_previo_sent_at: new Date().toISOString(),
      recordatorio_previo_campaign_id: args.campaignId,
    })
    .eq("id", args.sorteoId)
    .eq("empresa_id", args.empresaId);
}

/** Participantes con pago confirmado, sin repetir teléfono. */
async function cargarAudiencia(args: {
  sb: SupabaseAdmin;
  empresaId: string;
  sorteoId: string;
}): Promise<{ entradaId: string; telefono: string; nombre: string; conversationId: string | null }[]> {
  const { data, error } = await args.sb
    .from("sorteo_entradas")
    .select("id, whatsapp_numero, nombre_participante, chat_conversation_id")
    .eq("empresa_id", args.empresaId)
    .eq("sorteo_id", args.sorteoId)
    .eq("estado_pago", "confirmado")
    .limit(RECORDATORIO_MAX_RECIPIENTS * 2);
  if (error) throw new Error(`lookup participantes: ${error.message}`);

  const vistos = new Set<string>();
  const salida: { entradaId: string; telefono: string; nombre: string; conversationId: string | null }[] = [];
  for (const row of (data ?? []) as EntradaRow[]) {
    const telefono = (row.whatsapp_numero ?? "").trim();
    if (!telefono) continue;
    const norm = normalizeCampaignPhone(telefono);
    const clave = norm.ok ? norm.e164 : telefono.replace(/\D+/g, "");
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({
      entradaId: row.id,
      telefono,
      nombre: (row.nombre_participante ?? "").trim(),
      conversationId: row.chat_conversation_id ?? null,
    });
    if (salida.length >= RECORDATORIO_MAX_RECIPIENTS) break;
  }
  return salida;
}

/**
 * Despacha los avisos que quedaron en curso.
 *
 * El worker de campañas lo mueve el navegador (el panel de campañas llama a
 * `/api/campanas/process` mientras está abierto). Un aviso automático no tiene a nadie
 * mirando la pantalla, así que el propio cron tiene que empujar los lotes.
 */
async function despacharAvisosEnCurso(args: {
  sb: SupabaseAdmin;
  empresaId: string;
  maxSend: number;
}): Promise<number> {
  const { sb, empresaId, maxSend } = args;
  if (maxSend <= 0) return 0;

  const { data, error } = await sb
    .from("chat_campaigns")
    .select("id, send_config_json")
    .eq("empresa_id", empresaId)
    .eq("status", "sending");
  if (error) return 0;

  const propias = ((data ?? []) as { id: string; send_config_json?: unknown }[]).filter((c) => {
    const cfg = c.send_config_json;
    if (!cfg || typeof cfg !== "object") return false;
    const source = (cfg as { source?: { kind?: string } }).source;
    return source?.kind === "sorteo_recordatorio_previo";
  });

  let despachados = 0;
  for (const camp of propias) {
    while (despachados < maxSend) {
      const res = await runCampaignProcessOnce({
        supabase: sb,
        empresaId,
        campaignId: camp.id,
        batchSize: Math.min(PROCESS_BATCH_SIZE, maxSend - despachados),
      });
      despachados += res.processed;
      if (res.processed === 0 || res.campaignCompleted || res.remainingQueued === 0) break;
    }
    if (despachados >= maxSend) break;
  }
  return despachados;
}

/** Id de correlación para los logs del cron. */
export function nuevoRunId(): string {
  return randomUUID();
}
