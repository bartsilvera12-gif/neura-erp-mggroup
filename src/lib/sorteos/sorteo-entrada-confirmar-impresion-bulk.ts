import { getChatPostgresPool, getChatPostgresConnectionString, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import {
  assertAllowedChatDataSchema,
  isLikelyUnexposedTenantChatSchema,
} from "@/lib/supabase/chat-data-schema";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";

/** Tope de órdenes por una sola marca en tanda (acompaña a PHYSICAL_COUPONS_PRINT_MAX). */
export const CONFIRMAR_IMPRESION_BULK_MAX = 8000;

export type ConfirmarImpresionBulkOk = {
  ok: true;
  /** Cantidad de órdenes que quedaron marcadas como impresas en esta operación. */
  entradas_marcadas: number;
  cupones_impresos_at: string;
};

export type ConfirmarImpresionBulkErr = {
  ok: false;
  status: number;
  message: string;
};

export type ConfirmarImpresionBulkResult = ConfirmarImpresionBulkOk | ConfirmarImpresionBulkErr;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * Marca como impresas (sorteo_entradas.cupones_impresos_at) un conjunto de órdenes de un sorteo.
 * No toca sorteo_cupones ni estado_pago. Idempotente: re-marcar actualiza la fecha.
 */
export async function confirmarImpresionCuponesEntradasBulk(params: {
  empresaId: string;
  usuarioUuid: string | null;
  sorteoId: string;
  entradaIds: string[];
}): Promise<ConfirmarImpresionBulkResult> {
  const { empresaId, usuarioUuid, sorteoId } = params;

  if (!isUuid(sorteoId)) {
    return { ok: false, status: 400, message: "sorteo_id inválido." };
  }

  const entradaIds = [...new Set((params.entradaIds ?? []).map((s) => String(s).trim()).filter(Boolean))];
  if (entradaIds.length === 0) {
    return { ok: false, status: 400, message: "No se recibieron órdenes para marcar." };
  }
  if (entradaIds.some((id) => !isUuid(id))) {
    return { ok: false, status: 400, message: "Hay identificadores de orden inválidos." };
  }
  if (entradaIds.length > CONFIRMAR_IMPRESION_BULK_MAX) {
    return {
      ok: false,
      status: 400,
      message: `No se pueden marcar más de ${CONFIRMAR_IMPRESION_BULK_MAX} órdenes a la vez. Acotá por fecha o búsqueda.`,
    };
  }

  const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);

  if (isLikelyUnexposedTenantChatSchema(dataSchema)) {
    if (!getChatPostgresConnectionString()) {
      return {
        ok: false,
        status: 503,
        message:
          "Tenant no expuesto en PostgREST: configurá SUPABASE_DB_URL o DIRECT_URL para confirmar impresión.",
      };
    }
    return marcarPg(empresaId, dataSchema, sorteoId, entradaIds, usuarioUuid);
  }

  return marcarPostgrest(empresaId, sorteoId, entradaIds, usuarioUuid);
}

async function marcarPg(
  empresaId: string,
  dataSchema: string,
  sorteoId: string,
  entradaIds: string[],
  usuarioUuid: string | null
): Promise<ConfirmarImpresionBulkResult> {
  const pool = getChatPostgresPool();
  if (!pool) {
    return { ok: false, status: 503, message: "Sin pool Postgres para actualizar el esquema del tenant." };
  }

  const sch = assertAllowedChatDataSchema(dataSchema);
  const tEnt = quoteSchemaTable(sch, "sorteo_entradas");
  const tCup = quoteSchemaTable(sch, "sorteo_cupones");

  try {
    // Marca cada orden y guarda su cantidad de cupones (subconsulta correlacionada).
    // Solo órdenes del sorteo con al menos un cupón registrado.
    const res = await pool.query(
      `UPDATE ${tEnt} se
       SET cupones_impresos_at = now(),
           cupones_impresos_by = $1::uuid,
           cupones_impresion_count = (
             SELECT COUNT(*)::int FROM ${tCup} c
             WHERE c.entrada_id = se.id AND c.empresa_id = se.empresa_id
           ),
           updated_at = now()
       WHERE se.empresa_id = $2::uuid
         AND se.sorteo_id = $3::uuid
         AND se.id = ANY($4::uuid[])
         AND EXISTS (
           SELECT 1 FROM ${tCup} c
           WHERE c.entrada_id = se.id AND c.empresa_id = se.empresa_id
         )
       RETURNING se.id`,
      [usuarioUuid, empresaId, sorteoId, entradaIds]
    );
    return {
      ok: true,
      entradas_marcadas: res.rowCount ?? res.rows?.length ?? 0,
      cupones_impresos_at: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 500, message: msg };
  }
}

async function marcarPostgrest(
  empresaId: string,
  sorteoId: string,
  entradaIds: string[],
  usuarioUuid: string | null
): Promise<ConfirmarImpresionBulkResult> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const nowIso = new Date().toISOString();

  const row: Record<string, unknown> = {
    cupones_impresos_at: nowIso,
    updated_at: nowIso,
  };
  if (usuarioUuid) {
    row.cupones_impresos_by = usuarioUuid;
  }

  const { data, error } = await sb
    .from("sorteo_entradas")
    .update(row)
    .eq("empresa_id", empresaId)
    .eq("sorteo_id", sorteoId)
    .in("id", entradaIds)
    .select("id");

  if (error) {
    return { ok: false, status: 400, message: error.message };
  }

  return {
    ok: true,
    entradas_marcadas: Array.isArray(data) ? data.length : 0,
    cupones_impresos_at: nowIso,
  };
}
