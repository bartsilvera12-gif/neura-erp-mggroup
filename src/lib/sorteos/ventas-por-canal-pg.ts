import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { asuncionDayBoundsUtc } from "@/lib/sorteos/kpis-time-bounds";

/**
 * Por dónde entró cada venta.
 *
 * - `bot`: la hizo la propia persona por WhatsApp, con el flujo del bot.
 * - `vendedor`: la cargó un vendedor, desde su punto de venta o con #VENTA.
 * - `manual`: la cargó alguien de la empresa desde el ERP.
 *
 * Es la misma frontera que usa el bot para decidir de qué compras anteriores puede reusar
 * datos, así que una venta cae en el mismo lado en todas las pantallas.
 */
export type CanalVenta = "bot" | "vendedor" | "manual";

export type TotalesCanal = {
  canal: CanalVenta;
  ventas: number;
  boletas: number;
  boletas_hoy: number;
  monto: number;
  /** Ventas esperando que alguien revise el comprobante: plata que todavía no está confirmada. */
  pendientes: number;
};

export type DiaBot = { dia: string; boletas: number; monto: number };

export type VentasPorCanal = {
  canales: TotalesCanal[];
  /** Boletas y monto del bot por día, para ver cómo viene vendiendo. */
  serieBot: DiaBot[];
};

/** Cuántos días mostrar en la serie cuando no se eligió un período. */
const DIAS_SERIE_POR_DEFECTO = 14;

/**
 * Totales por canal de un sorteo, más la serie diaria del bot.
 *
 * Mismo criterio de venta que el ranking de vendedores —se excluyen las rechazadas, las
 * boletas son cupones emitidos, los filtros de fecha son los mismos— para que la suma de los
 * tres canales dé lo mismo que el resto del panel.
 *
 * `venta_origen` se lee con `to_jsonb` porque es una columna opcional: hay esquemas donde no
 * existe y referenciarla directo rompería la consulta entera.
 */
export async function cargarVentasPorCanal(
  pool: Pool,
  schema: string,
  empresaId: string,
  sorteoId: string,
  filtros: { desdeIso?: string | null; hastaIso?: string | null } = {}
): Promise<VentasPorCanal> {
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");
  const dia = asuncionDayBoundsUtc();

  const canal = `
    CASE
      WHEN e.revendedor_id IS NOT NULL THEN 'vendedor'
      WHEN e.chat_conversation_id IS NOT NULL
           AND COALESCE(to_jsonb(e) ->> 'venta_origen', 'whatsapp_flow') <> 'erp_manual'
        THEN 'bot'
      ELSE 'manual'
    END
  `;

  const rango = `
    AND ($5::timestamptz IS NULL OR e.created_at >= $5::timestamptz)
    AND ($6::timestamptz IS NULL OR e.created_at <= $6::timestamptz)
  `;

  const params = [
    empresaId,
    sorteoId,
    dia.start,
    dia.end,
    filtros.desdeIso ?? null,
    filtros.hastaIso ?? null,
  ];

  const sqlCanales = `
    WITH ent AS (
      SELECT e.id, e.monto_total, e.estado_pago, e.created_at, ${canal} AS canal
        FROM ${tEnt} e
       WHERE e.empresa_id = $1::uuid
         AND e.sorteo_id = $2::uuid
         AND e.estado_pago <> 'rechazado'
         ${rango}
    ),
    cup AS (
      SELECT c.entrada_id, COUNT(*)::bigint AS n
        FROM ${tCup} c
       WHERE c.entrada_id IN (SELECT id FROM ent)
       GROUP BY c.entrada_id
    )
    SELECT ent.canal,
           COUNT(*)::bigint                                          AS ventas,
           COALESCE(SUM(cup.n), 0)::bigint                           AS boletas,
           COALESCE(SUM(cup.n) FILTER (
             WHERE ent.created_at >= $3::timestamptz AND ent.created_at <= $4::timestamptz
           ), 0)::bigint                                             AS boletas_hoy,
           COALESCE(SUM(ent.monto_total), 0)::numeric                AS monto,
           COUNT(*) FILTER (WHERE ent.estado_pago = 'pendiente_revision')::bigint AS pendientes
      FROM ent
      LEFT JOIN cup ON cup.entrada_id = ent.id
     GROUP BY ent.canal
  `;

  /**
   * Serie del bot. Sin período elegido muestra las últimas dos semanas: la serie completa de
   * un sorteo largo no entra en el gráfico y lo que interesa es cómo viene vendiendo ahora.
   */
  const sqlSerie = `
    SELECT to_char((e.created_at AT TIME ZONE 'America/Asuncion')::date, 'YYYY-MM-DD') AS dia,
           COALESCE(SUM(cup.n), 0)::bigint           AS boletas,
           COALESCE(SUM(e.monto_total), 0)::numeric  AS monto
      FROM ${tEnt} e
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::bigint AS n FROM ${tCup} c WHERE c.entrada_id = e.id
      ) cup ON true
     WHERE e.empresa_id = $1::uuid
       AND e.sorteo_id = $2::uuid
       AND e.estado_pago <> 'rechazado'
       AND (${canal}) = 'bot'
       AND e.created_at >= COALESCE($3::timestamptz, now() - make_interval(days => $5::int))
       AND ($4::timestamptz IS NULL OR e.created_at <= $4::timestamptz)
     GROUP BY 1
     ORDER BY 1
  `;

  const [rc, rs] = await Promise.all([
    pool.query(sqlCanales, params),
    pool.query(sqlSerie, [
      empresaId,
      sorteoId,
      filtros.desdeIso ?? null,
      filtros.hastaIso ?? null,
      DIAS_SERIE_POR_DEFECTO,
    ]),
  ]);

  const porCanal = new Map<string, Record<string, unknown>>(
    (rc.rows ?? []).map((row: Record<string, unknown>) => [String(row.canal), row])
  );

  /** Los tres canales siempre, aunque alguno no tenga ventas: una fila en cero también informa. */
  const canales: TotalesCanal[] = (["bot", "vendedor", "manual"] as const).map((c) => {
    const row = porCanal.get(c);
    return {
      canal: c,
      ventas: Number(row?.ventas ?? 0),
      boletas: Number(row?.boletas ?? 0),
      boletas_hoy: Number(row?.boletas_hoy ?? 0),
      monto: Number(row?.monto ?? 0),
      pendientes: Number(row?.pendientes ?? 0),
    };
  });

  const serieBot: DiaBot[] = (rs.rows ?? []).map((row: Record<string, unknown>) => ({
    dia: String(row.dia ?? ""),
    boletas: Number(row.boletas ?? 0),
    monto: Number(row.monto ?? 0),
  }));

  return { canales, serieBot };
}
