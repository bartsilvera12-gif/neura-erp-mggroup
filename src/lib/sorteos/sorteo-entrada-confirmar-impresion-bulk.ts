import { getChatPostgresPool, getChatPostgresConnectionString, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import {
  assertAllowedChatDataSchema,
  isLikelyUnexposedTenantChatSchema,
} from "@/lib/supabase/chat-data-schema";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";

/** Tope de órdenes por una sola marca en tanda (acompaña a PHYSICAL_COUPONS_PRINT_MAX). */
export const CONFIRMAR_IMPRESION_BULK_MAX = 8000;

/** Una compra que salió impresa a medias: no se marca, porque le faltan boletas. */
export type OrdenImpresaParcial = {
  numero_orden: number | null;
  impresas: number;
  total: number;
};

export type ConfirmarImpresionBulkOk = {
  ok: true;
  /** Cantidad de órdenes que quedaron marcadas como impresas en esta operación. */
  entradas_marcadas: number;
  /**
   * Compras que la tanda imprimió solo en parte: quedan sin marcar, para que sus boletas
   * faltantes vuelvan a salir en la próxima.
   */
  parciales: OrdenImpresaParcial[];
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
  /**
   * Cuántas boletas de cada compra entraron en la tanda impresa (mismo orden que `entradaIds`).
   *
   * La impresión filtra por número de boleta, pero la marca de impresa se guarda por compra
   * entera. Sin este dato, imprimir «del 1 al 8.312» y marcar la tanda marcaba también compras
   * con boletas fuera de ese rango, y esas boletas no volvían a salir nunca: 439 en MG. Con el
   * dato, se marcan solo las compras impresas completas.
   *
   * Si no viene (llamadas viejas), se marca todo como antes.
   */
  impresasPorEntrada?: number[] | null;
  /**
   * Deshacer: deja las órdenes como no impresas. Es la salida cuando la impresora falló y la
   * tanda ya se había registrado, para poder imprimirla de nuevo.
   */
  desmarcar?: boolean;
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

  const impresas = params.desmarcar
    ? null
    : alinearImpresas(params.entradaIds ?? [], entradaIds, params.impresasPorEntrada);

  const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);

  if (params.desmarcar) {
    return desmarcar(empresaId, dataSchema, sorteoId, entradaIds);
  }

  if (isLikelyUnexposedTenantChatSchema(dataSchema)) {
    if (!getChatPostgresConnectionString()) {
      return {
        ok: false,
        status: 503,
        message:
          "Tenant no expuesto en PostgREST: configurá SUPABASE_DB_URL o DIRECT_URL para confirmar impresión.",
      };
    }
    return marcarPg(empresaId, dataSchema, sorteoId, entradaIds, usuarioUuid, impresas);
  }

  return marcarPostgrest(empresaId, sorteoId, entradaIds, usuarioUuid, impresas);
}

/**
 * Pasa la lista «cuántas boletas se imprimieron de cada compra» a un mapa por id.
 *
 * `entradaIds` ya viene sin repetidos, así que el conteo se alinea por posición con el pedido
 * original. Si falta el dato de alguna compra, se devuelve null y se marca todo como antes:
 * mejor eso que decidir con información incompleta.
 */
/**
 * Separa las compras que salieron impresas completas de las que salieron a medias.
 *
 * `impresas` dice cuántas boletas de cada compra entraron en la tanda; `totales`, cuántas
 * tiene cada compra. Las que no están completas no se marcan, así sus boletas faltantes
 * vuelven a salir en la próxima tanda.
 */
export function separarCompletasYParciales(
  totales: Array<{ id: string; numero_orden: number | null; total: number }>,
  impresas: Map<string, number>
): { completas: Set<string>; parciales: OrdenImpresaParcial[] } {
  const completas = new Set<string>();
  const parciales: OrdenImpresaParcial[] = [];
  for (const fila of totales) {
    const impresasDeEsta = impresas.get(fila.id) ?? 0;
    if (impresasDeEsta >= fila.total) completas.add(fila.id);
    else {
      parciales.push({ numero_orden: fila.numero_orden, impresas: impresasDeEsta, total: fila.total });
    }
  }
  parciales.sort((a, b) => (a.numero_orden ?? 0) - (b.numero_orden ?? 0));
  return { completas, parciales };
}

export function alinearImpresas(
  entradaIdsOriginales: string[],
  entradaIds: string[],
  impresasPorEntrada: number[] | null | undefined
): Map<string, number> | null {
  if (!Array.isArray(impresasPorEntrada) || impresasPorEntrada.length === 0) return null;
  const porId = new Map<string, number>();
  entradaIdsOriginales.forEach((id, i) => {
    const n = Number(impresasPorEntrada[i]);
    const key = String(id).trim();
    if (!key || !Number.isFinite(n) || n < 0) return;
    porId.set(key, Math.max(porId.get(key) ?? 0, Math.trunc(n)));
  });
  return entradaIds.every((id) => porId.has(id)) ? porId : null;
}

/**
 * Vuelve las órdenes a «no impresas». Solo toca la marca: no cambia cupones ni estado de pago.
 */
async function desmarcar(
  empresaId: string,
  dataSchema: string,
  sorteoId: string,
  entradaIds: string[]
): Promise<ConfirmarImpresionBulkResult> {
  const nowIso = new Date().toISOString();
  const limpio = {
    cupones_impresos_at: null,
    cupones_impresos_by: null,
    cupones_impresion_count: null,
    updated_at: nowIso,
  };

  if (isLikelyUnexposedTenantChatSchema(dataSchema)) {
    const pool = getChatPostgresPool();
    if (!pool) {
      return { ok: false, status: 503, message: "Sin pool Postgres para actualizar el esquema del tenant." };
    }
    const sch = assertAllowedChatDataSchema(dataSchema);
    const tEnt = quoteSchemaTable(sch, "sorteo_entradas");
    try {
      const res = await pool.query(
        `UPDATE ${tEnt} se
            SET cupones_impresos_at = NULL,
                cupones_impresos_by = NULL,
                cupones_impresion_count = NULL,
                updated_at = now()
          WHERE se.empresa_id = $1::uuid
            AND se.sorteo_id = $2::uuid
            AND se.id = ANY($3::uuid[])
          RETURNING se.id`,
        [empresaId, sorteoId, entradaIds]
      );
      return {
        ok: true,
        entradas_marcadas: res.rowCount ?? res.rows?.length ?? 0,
        parciales: [],
        cupones_impresos_at: nowIso,
      };
    } catch (e) {
      return { ok: false, status: 500, message: e instanceof Error ? e.message : String(e) };
    }
  }

  const sb = await getChatServiceClientForEmpresa(empresaId);
  const { data, error } = await sb
    .from("sorteo_entradas")
    .update(limpio)
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
    parciales: [],
    cupones_impresos_at: nowIso,
  };
}

async function marcarPg(
  empresaId: string,
  dataSchema: string,
  sorteoId: string,
  entradaIds: string[],
  usuarioUuid: string | null,
  impresas: Map<string, number> | null
): Promise<ConfirmarImpresionBulkResult> {
  const pool = getChatPostgresPool();
  if (!pool) {
    return { ok: false, status: 503, message: "Sin pool Postgres para actualizar el esquema del tenant." };
  }

  const sch = assertAllowedChatDataSchema(dataSchema);
  const tEnt = quoteSchemaTable(sch, "sorteo_entradas");
  const tCup = quoteSchemaTable(sch, "sorteo_cupones");

  try {
    /**
     * Compras impresas a medias: se dejan sin marcar y se informan, así sus boletas faltantes
     * vuelven a salir en la próxima tanda.
     */
    let parciales: OrdenImpresaParcial[] = [];
    let aMarcar: string[] = entradaIds;
    if (impresas) {
      const totRes = await pool.query<{ id: string; numero_orden: number | null; total: number }>(
        `SELECT se.id::text AS id,
                se.numero_orden,
                (SELECT COUNT(*)::int FROM ${tCup} c
                  WHERE c.entrada_id = se.id AND c.empresa_id = se.empresa_id) AS total
           FROM ${tEnt} se
          WHERE se.empresa_id = $1::uuid
            AND se.sorteo_id = $2::uuid
            AND se.id = ANY($3::uuid[])`,
        [empresaId, sorteoId, entradaIds]
      );
      const sep = separarCompletasYParciales(totRes.rows, impresas);
      parciales = sep.parciales;
      aMarcar = entradaIds.filter((id) => sep.completas.has(id));
      if (aMarcar.length === 0) {
        return {
          ok: true,
          entradas_marcadas: 0,
          parciales,
          cupones_impresos_at: new Date().toISOString(),
        };
      }
    }

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
      [usuarioUuid, empresaId, sorteoId, aMarcar]
    );
    return {
      ok: true,
      entradas_marcadas: res.rowCount ?? res.rows?.length ?? 0,
      parciales,
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
  usuarioUuid: string | null,
  impresas: Map<string, number> | null
): Promise<ConfirmarImpresionBulkResult> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const nowIso = new Date().toISOString();

  /** Mismo criterio que por base directa: no marcar compras impresas a medias. */
  let parciales: OrdenImpresaParcial[] = [];
  let aMarcar: string[] = entradaIds;
  if (impresas) {
    const { data: cupRows, error: cupErr } = await sb
      .from("sorteo_cupones")
      .select("entrada_id")
      .eq("empresa_id", empresaId)
      .in("entrada_id", entradaIds);
    if (cupErr) {
      return { ok: false, status: 400, message: cupErr.message };
    }
    const totalPorEntrada = new Map<string, number>();
    for (const r of (cupRows ?? []) as Array<{ entrada_id?: string }>) {
      const id = String(r.entrada_id ?? "").trim();
      if (id) totalPorEntrada.set(id, (totalPorEntrada.get(id) ?? 0) + 1);
    }
    const { data: ordRows } = await sb
      .from("sorteo_entradas")
      .select("id, numero_orden")
      .eq("empresa_id", empresaId)
      .in("id", entradaIds);
    const ordenPorId = new Map<string, number | null>(
      ((ordRows ?? []) as Array<{ id?: string; numero_orden?: number | null }>).map((r) => [
        String(r.id ?? ""),
        r.numero_orden ?? null,
      ])
    );
    const sep = separarCompletasYParciales(
      entradaIds.map((id) => ({
        id,
        numero_orden: ordenPorId.get(id) ?? null,
        total: totalPorEntrada.get(id) ?? 0,
      })),
      impresas
    );
    parciales = sep.parciales;
    aMarcar = entradaIds.filter((id) => sep.completas.has(id));
    if (aMarcar.length === 0) {
      return { ok: true, entradas_marcadas: 0, parciales, cupones_impresos_at: nowIso };
    }
  }

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
    .in("id", aMarcar)
    .select("id");

  if (error) {
    return { ok: false, status: 400, message: error.message };
  }

  return {
    ok: true,
    entradas_marcadas: Array.isArray(data) ? data.length : 0,
    parciales,
    cupones_impresos_at: nowIso,
  };
}
