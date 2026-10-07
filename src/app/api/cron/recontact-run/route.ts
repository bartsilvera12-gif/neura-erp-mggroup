import { NextRequest, NextResponse } from "next/server";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { runRecontactForEmpresa, type RecontactExecResult } from "@/lib/chat/recontact-executor";

/**
 * Motor de recontacto (seguimiento automático) — cron.
 *
 * Cada pasada, por cada empresa configurada:
 *   1. Toma las reglas `activo=true`.
 *   2. Selecciona candidatos (idle, cooldown, max_attempts, guardas, ventana de 24h).
 *   3. Respeta la franja horaria (`schedule_config`) y envía el texto de seguimiento.
 *   4. Registra cada intento en `chat_flow_recontact_runs`.
 *
 * Conviene programarlo cada 15 min: es idempotente (cooldown / max_attempts por regla) y hay un
 * candado por empresa que evita pasadas solapadas.
 *
 * Seguridad: `Authorization: Bearer <CRON_SECRET>`. Sin secret en env → 401.
 *
 * Query:
 *   - `dry_run=true`: informa a quién le llegaría sin enviar ni registrar nada.
 *   - `max_send`: tope de mensajes enviados en la pasada (default 200).
 */

const LOG = "[cron/recontact-run]";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization")?.trim() ?? "";
  return header === `Bearer ${expected}`;
}

/** Misma resolución que los otros crons: nunca operar sobre la empresa equivocada. */
function resolveEmpresaIds(): string[] {
  getSingleClientSchemaOrNull(); // valida el modo (lanza si single_client sin NEURA_CLIENT_SCHEMA)
  const envEmpresaId = process.env.NEURA_CLIENT_EMPRESA_ID?.trim();
  return envEmpresaId ? [envEmpresaId] : [];
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const runId = `rc_${Date.now().toString(36)}`;
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const maxSendRaw = parseInt(url.searchParams.get("max_send") ?? "", 10);
  const maxSend = Number.isFinite(maxSendRaw) && maxSendRaw > 0 ? maxSendRaw : 200;

  const empresaIds = resolveEmpresaIds();
  if (empresaIds.length === 0) {
    console.warn(LOG, "sin_empresa_configurada", {
      run_id: runId,
      hint: "Setear NEURA_CLIENT_EMPRESA_ID con el empresa_id real del cliente.",
    });
    return NextResponse.json({ ok: true, run_id: runId, resultados: [], nota: "sin empresa configurada" });
  }

  const resultados: RecontactExecResult[] = [];
  const errores: { empresa_id: string; error: string }[] = [];

  for (const empresaId of empresaIds) {
    try {
      const res = await runRecontactForEmpresa({ empresaId, dryRun, maxSend });
      resultados.push(res);
      console.info(LOG, "empresa_ok", {
        run_id: runId,
        empresa_id: empresaId.slice(0, 8),
        dry_run: res.dry_run,
        locked: res.locked,
        rules: res.rules_evaluated,
        candidatos: res.total_candidates,
        enviados: res.total_sent,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error desconocido";
      errores.push({ empresa_id: empresaId, error: msg });
      console.error(LOG, "empresa_error", { run_id: runId, empresa_id: empresaId.slice(0, 8), error: msg });
    }
  }

  return NextResponse.json({ ok: errores.length === 0, run_id: runId, resultados, errores });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
