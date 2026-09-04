import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { asuncionDayBoundsUtc } from "@/lib/sorteos/kpis-time-bounds";

export type RevendedorRankingRow = {
  revendedor_id: string;
  nombre: string;
  activo: boolean;
  boletas: number;
  boletas_hoy: number;
  ventas: number;
  monto: number;
};

export type RevendedoresRanking = {
  revendedores: RevendedorRankingRow[];
  totales: { boletas: number; boletas_hoy: number; ventas: number; monto: number };
};

/**
 * Ranking de revendedores de un sorteo, ordenado por boletas vendidas, en UNA consulta.
 *
 * El endpoint por revendedor (`/revendedores/:revId/stats`) hace varias consultas para cada
 * uno: para un ranking serían decenas de viajes, y la base está lejos del servidor.
 *
 * Mismo criterio de venta que los KPIs del panel (`estado_pago <> 'rechazado'`, boletas =
 * cupones emitidos) para que las pantallas no muestren números distintos.
 */
export async function cargarRankingRevendedores(
  pool: Pool,
  schema: string,
  empresaId: string,
  sorteoId: string
): Promise<RevendedoresRanking> {
  const tRev = quoteSchemaTable(schema, "sorteo_revendedores");
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");
  const dia = asuncionDayBoundsUtc();

  /**
   * Monto y boletas se agregan por separado a propósito: juntar entradas con cupones en un
   * solo GROUP BY multiplicaría el monto por la cantidad de cupones de cada venta.
   */
  const sql = `
    WITH ventas AS (
      SELECT e.revendedor_id,
             COUNT(*)::bigint AS ventas,
             COALESCE(SUM(e.monto_total), 0)::numeric AS monto
        FROM ${tEnt} e
       WHERE e.empresa_id = $1::uuid
         AND e.sorteo_id = $2::uuid
         AND e.revendedor_id IS NOT NULL
         AND e.estado_pago <> 'rechazado'
       GROUP BY e.revendedor_id
    ),
    boletas AS (
      SELECT e.revendedor_id,
             COUNT(c.id)::bigint AS boletas,
             COUNT(c.id) FILTER (
               WHERE e.created_at >= $3::timestamptz AND e.created_at <= $4::timestamptz
             )::bigint AS boletas_hoy
        FROM ${tCup} c
        JOIN ${tEnt} e ON e.id = c.entrada_id
       WHERE e.empresa_id = $1::uuid
         AND e.sorteo_id = $2::uuid
         AND e.revendedor_id IS NOT NULL
         AND e.estado_pago <> 'rechazado'
       GROUP BY e.revendedor_id
    )
    SELECT r.id::text               AS revendedor_id,
           r.nombre                 AS nombre,
           COALESCE(r.activo, true) AS activo,
           COALESCE(b.boletas, 0)::bigint     AS boletas,
           COALESCE(b.boletas_hoy, 0)::bigint AS boletas_hoy,
           COALESCE(v.ventas, 0)::bigint      AS ventas,
           COALESCE(v.monto, 0)::numeric      AS monto
      FROM ${tRev} r
      LEFT JOIN ventas  v ON v.revendedor_id = r.id
      LEFT JOIN boletas b ON b.revendedor_id = r.id
     WHERE r.empresa_id = $1::uuid
       AND r.sorteo_id = $2::uuid
     ORDER BY boletas DESC, monto DESC, r.nombre ASC
  `;

  const r = await pool.query(sql, [empresaId, sorteoId, dia.start, dia.end]);

  const revendedores: RevendedorRankingRow[] = (r.rows ?? []).map(
    (row: Record<string, unknown>) => ({
      revendedor_id: String(row.revendedor_id ?? ""),
      nombre: String(row.nombre ?? "").trim() || "(sin nombre)",
      activo: row.activo !== false,
      boletas: Number(row.boletas ?? 0),
      boletas_hoy: Number(row.boletas_hoy ?? 0),
      ventas: Number(row.ventas ?? 0),
      monto: Number(row.monto ?? 0),
    })
  );

  return {
    revendedores,
    totales: {
      boletas: revendedores.reduce((a, f) => a + f.boletas, 0),
      boletas_hoy: revendedores.reduce((a, f) => a + f.boletas_hoy, 0),
      ventas: revendedores.reduce((a, f) => a + f.ventas, 0),
      monto: revendedores.reduce((a, f) => a + f.monto, 0),
    },
  };
}

/** Sorteo activo más reciente de la empresa; null si no hay ninguno. */
export async function sorteoActivoMasReciente(
  pool: Pool,
  schema: string,
  empresaId: string
): Promise<{ id: string; nombre: string } | null> {
  const t = quoteSchemaTable(schema, "sorteos");
  const r = await pool.query<{ id: string; nombre: string }>(
    `SELECT id::text AS id, nombre
       FROM ${t}
      WHERE empresa_id = $1::uuid AND estado = 'activo'
      ORDER BY created_at DESC
      LIMIT 1`,
    [empresaId]
  );
  const row = r.rows[0];
  return row ? { id: String(row.id), nombre: String(row.nombre ?? "") } : null;
}
