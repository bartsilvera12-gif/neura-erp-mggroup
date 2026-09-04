import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { asuncionDayBoundsUtc } from "@/lib/sorteos/kpis-time-bounds";

export const dynamic = "force-dynamic";

export type RevendedorRankingRow = {
  revendedor_id: string;
  nombre: string;
  activo: boolean;
  boletas: number;
  boletas_hoy: number;
  ventas: number;
  monto: number;
};

/**
 * GET /api/sorteos/:id/revendedores/ranking
 *
 * Ranking de revendedores por boletas vendidas, en UNA consulta agregada.
 *
 * El endpoint por revendedor (`/revendedores/:revId/stats`) hace varias consultas para cada
 * uno: para un ranking eso serían decenas de viajes a la base, y la base está lejos del
 * servidor. Acá se agrupa en SQL y se devuelve todo junto.
 *
 * Mismo criterio de venta que los KPIs del panel (`estado_pago <> 'rechazado'`) y las boletas
 * se cuentan como cupones emitidos, para que los números no discrepen entre pantallas.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id } = await params;
    const sorteoId = id.trim();
    if (!sorteoId) {
      return NextResponse.json(errorResponse("Sorteo inválido."), { status: 400 });
    }

    const empresaId = ctx.auth.empresa_id;
    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

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
      SELECT r.id::text            AS revendedor_id,
             r.nombre              AS nombre,
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

    const filas: RevendedorRankingRow[] = (r.rows ?? []).map((row: Record<string, unknown>) => ({
      revendedor_id: String(row.revendedor_id ?? ""),
      nombre: String(row.nombre ?? "").trim() || "(sin nombre)",
      activo: row.activo !== false,
      boletas: Number(row.boletas ?? 0),
      boletas_hoy: Number(row.boletas_hoy ?? 0),
      ventas: Number(row.ventas ?? 0),
      monto: Number(row.monto ?? 0),
    }));

    return NextResponse.json(
      successResponse({
        revendedores: filas,
        totales: {
          boletas: filas.reduce((a, f) => a + f.boletas, 0),
          boletas_hoy: filas.reduce((a, f) => a + f.boletas_hoy, 0),
          ventas: filas.reduce((a, f) => a + f.ventas, 0),
          monto: filas.reduce((a, f) => a + f.monto, 0),
        },
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[api/sorteos/:id/revendedores/ranking]", msg);
    return NextResponse.json(errorResponse("No se pudo cargar el ranking."), { status: 500 });
  }
}
