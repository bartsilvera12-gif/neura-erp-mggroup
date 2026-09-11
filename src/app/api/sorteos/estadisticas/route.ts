import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import {
  cargarRankingRevendedores,
  listarSorteosParaFiltro,
  sorteoActivoMasReciente,
} from "@/lib/sorteos/revendedores-ranking-pg";
import { cargarVentasPorCanal } from "@/lib/sorteos/ventas-por-canal-pg";

export const dynamic = "force-dynamic";

/** `YYYY-MM-DD` → extremos del día. Sin fecha, null: el ranking no se acota. */
function limite(valor: string | null, fin: boolean): string | null {
  const v = (valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return fin ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
}

/**
 * GET /api/sorteos/estadisticas
 *
 * Todo el panel de estadísticas en una sola llamada: campañas para el selector, ranking,
 * totales y progreso del sorteo. Se resuelve entero en el servidor porque cada ida y vuelta
 * a la base se paga cara, y pedir esto en cuatro pedazos desde el navegador multiplicaría
 * la espera.
 *
 * Parámetros: `sorteo_id` (por defecto el activo), `vendedor_id`, `desde`, `hasta`.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    const empresaId = ctx.auth.empresa_id;
    const sp = request.nextUrl.searchParams;

    const sorteos = await listarSorteosParaFiltro(pool, schema, empresaId);
    const pedido = (sp.get("sorteo_id") ?? "").trim();
    const elegido =
      (pedido && sorteos.find((s) => s.id === pedido)) ||
      (await sorteoActivoMasReciente(pool, schema, empresaId)) ||
      sorteos[0] ||
      null;

    if (!elegido) {
      return NextResponse.json(
        successResponse({
          sorteos,
          sorteo: null,
          revendedores: [],
          totales: null,
          progreso: null,
          canales: [],
          serieBot: [],
        })
      );
    }

    const desdeIso = limite(sp.get("desde"), false);
    const hastaIso = limite(sp.get("hasta"), true);

    /*
     * Ranking y canales en paralelo. Los canales no se acotan por vendedor: comparan el bot
     * contra los vendedores y la carga manual, así que filtrar por uno solo los vaciaría.
     */
    const [data, porCanal] = await Promise.all([
      cargarRankingRevendedores(pool, schema, empresaId, elegido.id, {
        desdeIso,
        hastaIso,
        revendedorId: (sp.get("vendedor_id") ?? "").trim() || null,
      }),
      cargarVentasPorCanal(pool, schema, empresaId, elegido.id, { desdeIso, hastaIso }),
    ]);

    return NextResponse.json(
      successResponse({
        sorteos,
        sorteo: { id: elegido.id, nombre: elegido.nombre },
        ...data,
        ...porCanal,
      })
    );
  } catch (e) {
    console.error("[api/sorteos/estadisticas]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudieron cargar las estadísticas."), {
      status: 500,
    });
  }
}
