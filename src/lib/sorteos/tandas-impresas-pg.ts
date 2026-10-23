import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

/**
 * Historial de impresión de cupones: qué tandas salieron y qué falta.
 *
 * Sin esto, «¿hasta dónde imprimimos?» solo se podía contestar mirando la base: el dato
 * estaba (cada compra guarda cuándo se marcó impresa), pero no se veía en ninguna pantalla.
 * Pasó con MG: imprimieron ~4.000 hojas, nadie supo dónde habían quedado y hubo que
 * reconstruirlo a mano.
 *
 * Una tanda es un marcado: todas las compras marcadas en la misma operación comparten el
 * instante exacto, porque `now()` es el mismo para toda la sentencia.
 */

export type TandaImpresa = {
  /** Instante del marcado (ISO). Identifica la tanda. */
  marcado_at: string;
  compras: number;
  boletas: number;
  /** Rango de números de orden que entró en la tanda: el «desde acá hasta acá». */
  orden_desde: number | null;
  orden_hasta: number | null;
};

export type ResumenImpresionCupones = {
  tandas: TandaImpresa[];
  /** Confirmadas que todavía no se imprimieron. */
  pendientes_compras: number;
  pendientes_boletas: number;
  impresas_compras: number;
  impresas_boletas: number;
};

/** Cuántas tandas se muestran: las últimas alcanzan para saber dónde se quedó. */
const TANDAS_VISIBLES = 12;

export async function cargarResumenImpresionCupones(
  pool: Pool,
  schema: string,
  empresaId: string,
  sorteoId: string
): Promise<ResumenImpresionCupones> {
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");

  /**
   * `cupones_impresion_count` guarda cuántas boletas tenía la compra al marcarla; si falta
   * (marcados viejos), se cuentan las boletas de la compra.
   */
  const boletasDe = `COALESCE(e.cupones_impresion_count,
    (SELECT COUNT(*)::int FROM ${tCup} c WHERE c.entrada_id = e.id))`;

  const sqlTandas = `
    SELECT e.cupones_impresos_at AS marcado_at,
           COUNT(*)::int         AS compras,
           COALESCE(SUM(${boletasDe}), 0)::int AS boletas,
           MIN(e.numero_orden)   AS orden_desde,
           MAX(e.numero_orden)   AS orden_hasta
      FROM ${tEnt} e
     WHERE e.empresa_id = $1::uuid
       AND e.sorteo_id = $2::uuid
       AND e.cupones_impresos_at IS NOT NULL
     GROUP BY e.cupones_impresos_at
     ORDER BY e.cupones_impresos_at DESC
     LIMIT ${TANDAS_VISIBLES}
  `;

  const sqlTotales = `
    SELECT COUNT(*) FILTER (WHERE e.cupones_impresos_at IS NOT NULL)::int AS impresas_compras,
           COALESCE(SUM(${boletasDe}) FILTER (WHERE e.cupones_impresos_at IS NOT NULL), 0)::int AS impresas_boletas,
           COUNT(*) FILTER (WHERE e.cupones_impresos_at IS NULL
                              AND e.estado_pago = 'confirmado')::int       AS pendientes_compras,
           COALESCE(SUM(${boletasDe}) FILTER (WHERE e.cupones_impresos_at IS NULL
                              AND e.estado_pago = 'confirmado'), 0)::int   AS pendientes_boletas
      FROM ${tEnt} e
     WHERE e.empresa_id = $1::uuid
       AND e.sorteo_id = $2::uuid
  `;

  const [rt, rs] = await Promise.all([
    pool.query(sqlTandas, [empresaId, sorteoId]),
    pool.query(sqlTotales, [empresaId, sorteoId]),
  ]);

  const tandas: TandaImpresa[] = (rt.rows ?? []).map((row: Record<string, unknown>) => ({
    marcado_at: new Date(String(row.marcado_at)).toISOString(),
    compras: Number(row.compras ?? 0),
    boletas: Number(row.boletas ?? 0),
    orden_desde: row.orden_desde == null ? null : Number(row.orden_desde),
    orden_hasta: row.orden_hasta == null ? null : Number(row.orden_hasta),
  }));

  const t = (rs.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    tandas,
    impresas_compras: Number(t.impresas_compras ?? 0),
    impresas_boletas: Number(t.impresas_boletas ?? 0),
    pendientes_compras: Number(t.pendientes_compras ?? 0),
    pendientes_boletas: Number(t.pendientes_boletas ?? 0),
  };
}
