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

export type ProgresoSorteo = {
  vendidas: number;
  maximo: number | null;
  restante: number | null;
};

export type RevendedoresRanking = {
  revendedores: RevendedorRankingRow[];
  totales: { boletas: number; boletas_hoy: number; ventas: number; monto: number };
  progreso: ProgresoSorteo;
};

export type FiltrosRanking = {
  /** ISO. Si falta, no se acota por fecha: el ranking es histórico del sorteo. */
  desdeIso?: string | null;
  hastaIso?: string | null;
  /** Un solo vendedor, para el análisis individual. */
  revendedorId?: string | null;
};

/**
 * Ranking de vendedores de un sorteo, ordenado por boletas vendidas, en UNA consulta.
 *
 * Mismo criterio de venta que los KPIs del panel (`estado_pago <> 'rechazado'`, boletas =
 * cupones emitidos) para que las pantallas no muestren números distintos.
 */
export async function cargarRankingRevendedores(
  pool: Pool,
  schema: string,
  empresaId: string,
  sorteoId: string,
  filtros: FiltrosRanking = {}
): Promise<RevendedoresRanking> {
  const tRev = quoteSchemaTable(schema, "sorteo_revendedores");
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");
  const tSor = quoteSchemaTable(schema, "sorteos");
  const dia = asuncionDayBoundsUtc();

  /**
   * Los filtros van como parámetros anulables en vez de armar SQL distinto: con `$n IS NULL
   * OR ...` la consulta es una sola y no hay concatenación de texto que revisar.
   */
  const params = [
    empresaId,
    sorteoId,
    dia.start,
    dia.end,
    filtros.desdeIso ?? null,
    filtros.hastaIso ?? null,
    filtros.revendedorId ?? null,
  ];

  const rangoVentas = `
    AND ($5::timestamptz IS NULL OR e.created_at >= $5::timestamptz)
    AND ($6::timestamptz IS NULL OR e.created_at <= $6::timestamptz)
  `;

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
         ${rangoVentas}
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
         ${rangoVentas}
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
       AND ($7::uuid IS NULL OR r.id = $7::uuid)
     ORDER BY boletas DESC, monto DESC, r.nombre ASC
  `;

  const [r, prog] = await Promise.all([
    pool.query(sql, params),
    pool.query<{ vendidas: string; maximo: number | null }>(
      `SELECT COALESCE(total_boletos_vendidos, 0)::bigint AS vendidas, max_boletos AS maximo
         FROM ${tSor} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [sorteoId, empresaId]
    ),
  ]);

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

  const pr = prog.rows[0];
  const vendidas = Number(pr?.vendidas ?? 0);
  const maximo = pr?.maximo == null ? null : Number(pr.maximo);

  return {
    revendedores,
    totales: {
      boletas: revendedores.reduce((a, f) => a + f.boletas, 0),
      boletas_hoy: revendedores.reduce((a, f) => a + f.boletas_hoy, 0),
      ventas: revendedores.reduce((a, f) => a + f.ventas, 0),
      monto: revendedores.reduce((a, f) => a + f.monto, 0),
    },
    /** Progreso del sorteo completo, no solo de los vendedores: es la meta del sorteo. */
    progreso: {
      vendidas,
      maximo,
      restante: maximo == null ? null : Math.max(0, maximo - vendidas),
    },
  };
}

/** Sorteos de la empresa para el selector de campaña; el activo primero. */
export async function listarSorteosParaFiltro(
  pool: Pool,
  schema: string,
  empresaId: string
): Promise<Array<{ id: string; nombre: string; estado: string }>> {
  const t = quoteSchemaTable(schema, "sorteos");
  const r = await pool.query(
    `SELECT id::text AS id, nombre, estado
       FROM ${t}
      WHERE empresa_id = $1::uuid
      ORDER BY (estado = 'activo') DESC, created_at DESC
      LIMIT 100`,
    [empresaId]
  );
  return (r.rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    nombre: String(row.nombre ?? "").trim(),
    estado: String(row.estado ?? "").trim(),
  }));
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
