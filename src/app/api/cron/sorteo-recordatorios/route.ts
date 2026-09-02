import { NextRequest, NextResponse } from "next/server";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import {
  RECORDATORIO_MAX_SEND_PER_RUN,
  nuevoRunId,
  runSorteoRecordatoriosOnce,
  type SorteoRecordatorioRunResult,
} from "@/lib/sorteos/sorteo-recordatorio-previo";

/**
 * Aviso previo al sorteo — cron.
 *
 * Cada pasada:
 *   1. Busca los sorteos con aviso activo cuya fecha cae dentro de `dias_antes` (hoy en PYT).
 *   2. Arma una campaña con los participantes que ya pagaron y la lanza.
 *   3. Empuja lotes de envío de los avisos en curso: el worker de campañas normalmente
 *      lo mueve el navegador, y acá no hay nadie con el panel abierto.
 *
 * Conviene programarlo cada 15 minutos: el paso 1 es idempotente (`recordatorio_previo_sent_at`)
 * y el paso 3 necesita varias pasadas para drenar la cola sin timeouts.
 *
 * Seguridad: `Authorization: Bearer <CRON_SECRET>`. Sin secret en env → 401.
 *
 * Query:
 *   - `dry_run=true`: informa a quién le llegaría el aviso sin crear ni enviar nada.
 *   - `max_send`: tope de mensajes despachados en la pasada (default 200).
 */

const LOG = "[cron/sorteo-recordatorios]";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization")?.trim() ?? "";
  return header === `Bearer ${expected}`;
}

/** Misma resolución que el cron de etiquetas: nunca operar sobre la empresa equivocada. */
function resolveEmpresaIds(): string[] {
  const singleSchema = getSingleClientSchemaOrNull();
  const envEmpresaId = process.env.NEURA_CLIENT_EMPRESA_ID?.trim();
  if (singleSchema) {
    return envEmpresaId ? [envEmpresaId] : [];
  }
  return envEmpresaId ? [envEmpresaId] : [];
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const runId = nuevoRunId();
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const maxSendRaw = parseInt(url.searchParams.get("max_send") ?? "", 10);
  const maxSendPerRun = Number.isFinite(maxSendRaw) && maxSendRaw > 0 ? maxSendRaw : RECORDATORIO_MAX_SEND_PER_RUN;

  const empresaIds = resolveEmpresaIds();
  if (empresaIds.length === 0) {
    console.warn(LOG, "sin_empresa_configurada", {
      run_id: runId,
      hint: "Setear NEURA_CLIENT_EMPRESA_ID con el empresa_id real del cliente.",
    });
    return NextResponse.json({ ok: true, run_id: runId, resultados: [], nota: "sin empresa configurada" });
  }

  const resultados: SorteoRecordatorioRunResult[] = [];
  const errores: { empresa_id: string; error: string }[] = [];

  for (const empresaId of empresaIds) {
    try {
      const res = await runSorteoRecordatoriosOnce({ empresaId, dryRun, maxSendPerRun });
      resultados.push(res);
      console.info(LOG, "empresa_ok", {
        run_id: runId,
        empresa_id: empresaId,
        fecha_py: res.fecha_py,
        creados: res.creados.length,
        omitidos: res.omitidos.length,
        despachados: res.despachados,
        dry_run: res.dry_run,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error desconocido";
      errores.push({ empresa_id: empresaId, error: msg });
      console.error(LOG, "empresa_error", { run_id: runId, empresa_id: empresaId, error: msg });
    }
  }

  return NextResponse.json({ ok: errores.length === 0, run_id: runId, resultados, errores });
}
