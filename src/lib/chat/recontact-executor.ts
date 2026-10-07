/**
 * Motor de recontacto (FASE 2 — ejecución real).
 *
 * Toma las reglas `activo=true`, selecciona candidatos con la MISMA lógica que la simulación
 * (`runRecontactDryRun`: idle, cooldown, max_attempts, guardas, ventana de 24h), respeta la franja
 * horaria (`schedule_config`) y envía un mensaje de TEXTO de seguimiento. Cada intento queda
 * registrado en `chat_flow_recontact_runs` (`decision='sent' | 'failed'`), lo que a su vez alimenta
 * el cooldown / max_attempts de la próxima pasada.
 *
 * MVP: solo texto dentro de la ventana de 24h (sin plantilla). Las reglas con mensaje de tipo
 * plantilla o sin texto se saltean sin enviar.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { runRecontactDryRun } from "@/lib/chat/recontact-dry-run";
import { isRecontactWindowOpen } from "@/lib/chat/recontact-schedule";
import {
  resolveOutboundTextContextFromConversationId,
  sendOutboundTextMessage,
} from "@/lib/chat/conversation-send-context";
import { persistOutgoingChatMessage } from "@/lib/chat/outgoing-message-persist";

const LOG = "[recontact-executor]";
const AUTOMATION_SOURCE = "recontact";
const DEFAULT_MAX_SEND = 200;
const SLEEP_BETWEEN_SENDS_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RecontactExecRuleResult = {
  rule_id: string;
  nombre: string;
  flow_code: string;
  window_open: boolean;
  candidates: number;
  sent: number;
  failed: number;
  skipped_no_text: number;
  errors: { conversation_id: string; error: string }[];
};

export type RecontactExecResult = {
  empresa_id: string;
  locked: boolean;
  dry_run: boolean;
  rules_evaluated: number;
  total_candidates: number;
  total_sent: number;
  por_regla: RecontactExecRuleResult[];
};

type RecontactRuleFullRow = {
  id: string;
  empresa_id: string;
  flow_code: string;
  nombre: string;
  included_node_codes: unknown;
  excluded_node_codes: unknown;
  idle_after_seconds: number;
  max_attempts: number;
  cooldown_seconds: number;
  guard_config: unknown;
  schedule_config: unknown;
  message_config: unknown;
};

const RULE_COLS =
  "id, empresa_id, flow_code, nombre, included_node_codes, excluded_node_codes, " +
  "idle_after_seconds, max_attempts, cooldown_seconds, guard_config, schedule_config, message_config";

/** Texto a enviar según message_config. Devuelve null si la regla no es texto enviable (MVP). */
function resolveSessionText(messageConfig: unknown): string | null {
  if (!messageConfig || typeof messageConfig !== "object" || Array.isArray(messageConfig)) return null;
  const mc = messageConfig as Record<string, unknown>;
  const type = typeof mc.message_type === "string" ? mc.message_type : "session_text";
  if (type !== "session_text") return null; // plantilla: fuera de alcance MVP
  const text = typeof mc.session_text === "string" ? mc.session_text.trim() : "";
  return text || null;
}

/** Sustitución simple de {{nombre}} (y {nombre}) por el nombre del contacto. */
function renderText(template: string, vars: { nombre: string | null }): string {
  const nombre = (vars.nombre ?? "").trim();
  return template.replace(/\{\{?\s*nombre\s*\}?\}/gi, nombre);
}

/**
 * Candado por empresa a nivel sesión (no transacción): evita que dos pasadas solapadas envíen
 * dos veces. Mantiene un client del pool tomado mientras dura el trabajo. Sin pool → best effort.
 */
async function acquireEmpresaLock(
  empresaId: string
): Promise<{ locked: boolean; release: () => Promise<void> }> {
  const pool = getChatPostgresPool();
  if (!pool) return { locked: true, release: async () => {} };
  const client = await pool.connect();
  try {
    const r = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`recontacto:${empresaId}`]
    );
    const locked = r.rows?.[0]?.locked === true;
    if (!locked) {
      client.release();
      return { locked: false, release: async () => {} };
    }
    return {
      locked: true,
      release: async () => {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`recontacto:${empresaId}`]);
        } catch {
          /* noop */
        } finally {
          client.release();
        }
      },
    };
  } catch (e) {
    client.release();
    throw e;
  }
}

export async function runRecontactForEmpresa(params: {
  empresaId: string;
  dryRun?: boolean;
  maxSend?: number;
  ruleId?: string | null;
  now?: Date;
  supabase?: AppSupabaseClient;
  dataSchema?: string;
}): Promise<RecontactExecResult> {
  const empresaId = params.empresaId;
  const dryRun = params.dryRun === true;
  const now = params.now ?? new Date();
  const maxSend = params.maxSend && params.maxSend > 0 ? Math.trunc(params.maxSend) : DEFAULT_MAX_SEND;
  const correlationId = `rc_${now.getTime().toString(36)}`;

  const supabase = params.supabase ?? (await getChatServiceClientForEmpresa(empresaId));
  const dataSchema = params.dataSchema ?? (await fetchDataSchemaForEmpresaId(empresaId));

  const base: RecontactExecResult = {
    empresa_id: empresaId,
    locked: true,
    dry_run: dryRun,
    rules_evaluated: 0,
    total_candidates: 0,
    total_sent: 0,
    por_regla: [],
  };

  const lock = await acquireEmpresaLock(empresaId);
  if (!lock.locked) {
    return { ...base, locked: false };
  }

  try {
    // El cron procesa solo reglas activas; el disparo manual ("enviar ahora") apunta a UNA regla
    // explícita y se permite aunque todavía no esté activa (para probarla antes de activarla).
    let query = supabase.from("chat_flow_recontact_rules").select(RULE_COLS).eq("empresa_id", empresaId);
    if (params.ruleId) query = query.eq("id", params.ruleId);
    else query = query.eq("activo", true);
    const { data: ruleRows, error: ruleErr } = await query;
    if (ruleErr) throw new Error(ruleErr.message);

    const rules = (ruleRows ?? []) as unknown as RecontactRuleFullRow[];
    base.rules_evaluated = rules.length;

    let budget = maxSend;

    for (const rule of rules) {
      const ruleResult: RecontactExecRuleResult = {
        rule_id: rule.id,
        nombre: rule.nombre,
        flow_code: rule.flow_code,
        window_open: isRecontactWindowOpen(rule.schedule_config, now),
        candidates: 0,
        sent: 0,
        failed: 0,
        skipped_no_text: 0,
        errors: [],
      };

      const sessionText = resolveSessionText(rule.message_config);

      const dry = await runRecontactDryRun({
        supabase,
        empresaId,
        dataSchema,
        flowCode: rule.flow_code,
        rule: {
          id: rule.id,
          empresa_id: rule.empresa_id,
          flow_code: rule.flow_code,
          included_node_codes: rule.included_node_codes,
          excluded_node_codes: rule.excluded_node_codes,
          idle_after_seconds: rule.idle_after_seconds,
          max_attempts: rule.max_attempts,
          cooldown_seconds: rule.cooldown_seconds,
          guard_config: rule.guard_config,
        },
      });

      const candidates = dry.rows.filter((r) => r.status === "candidate");
      ruleResult.candidates = candidates.length;
      base.total_candidates += candidates.length;

      // No enviar: simulación, ventana cerrada, sin texto enviable, o presupuesto agotado.
      if (dryRun || !ruleResult.window_open || !sessionText) {
        if (!sessionText && !dryRun) ruleResult.skipped_no_text = candidates.length;
        base.por_regla.push(ruleResult);
        continue;
      }

      for (const cand of candidates) {
        if (budget <= 0) break;
        budget -= 1;

        const text = renderText(sessionText, { nombre: cand.contact_name });
        try {
          const ctx = await resolveOutboundTextContextFromConversationId(supabase, cand.conversation_id, empresaId);
          const send = await sendOutboundTextMessage(ctx, text);

          if (send.ok) {
            await persistOutgoingChatMessage(supabase, {
              conversation: { id: cand.conversation_id, empresa_id: empresaId },
              content: text,
              messageType: "text",
              waMessageId: send.waMessageId,
              raw: { source: AUTOMATION_SOURCE, rule_id: rule.id, correlation_id: correlationId, provider: ctx.provider },
              senderType: "system",
              automationSource: AUTOMATION_SOURCE,
            });
            await recordRun(supabase, {
              empresaId,
              rule,
              conversationId: cand.conversation_id,
              decision: "sent",
              correlationId,
              payload: { wa_message_id: send.waMessageId, provider: ctx.provider, text_preview: text.slice(0, 120) },
            });
            ruleResult.sent += 1;
            base.total_sent += 1;
          } else {
            await recordRun(supabase, {
              empresaId,
              rule,
              conversationId: cand.conversation_id,
              decision: "failed",
              skipReason: "send_error",
              correlationId,
              payload: { error: send.error, code: send.code ?? null, status: send.status ?? null },
            });
            ruleResult.failed += 1;
            ruleResult.errors.push({ conversation_id: cand.conversation_id, error: send.error });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "error desconocido";
          await recordRun(supabase, {
            empresaId,
            rule,
            conversationId: cand.conversation_id,
            decision: "failed",
            skipReason: "resolve_error",
            correlationId,
            payload: { error: msg },
          }).catch(() => {});
          ruleResult.failed += 1;
          ruleResult.errors.push({ conversation_id: cand.conversation_id, error: msg });
        }

        await sleep(SLEEP_BETWEEN_SENDS_MS);
      }

      base.por_regla.push(ruleResult);
    }

    return base;
  } finally {
    await lock.release();
  }
}

async function recordRun(
  supabase: AppSupabaseClient,
  args: {
    empresaId: string;
    rule: RecontactRuleFullRow;
    conversationId: string;
    decision: "sent" | "failed";
    skipReason?: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("chat_flow_recontact_runs").insert({
    empresa_id: args.empresaId,
    rule_id: args.rule.id,
    flow_code: args.rule.flow_code,
    conversation_id: args.conversationId,
    decision: args.decision,
    skip_reason: args.skipReason ?? null,
    correlation_id: args.correlationId,
    payload_snapshot: args.payload,
  });
  if (error) {
    console.error(LOG, "record_run_error", { conversation_id: args.conversationId, error: error.message });
  }
}
