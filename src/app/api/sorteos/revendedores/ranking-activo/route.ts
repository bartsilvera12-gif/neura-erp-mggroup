import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import {
  cargarRankingRevendedores,
  sorteoActivoMasReciente,
} from "@/lib/sorteos/revendedores-ranking-pg";

export const dynamic = "force-dynamic";

/**
 * GET /api/sorteos/revendedores/ranking-activo
 *
 * Ranking del sorteo activo, para el widget del dashboard. Resuelve el sorteo en el servidor
 * en vez de pedirle al navegador que primero liste sorteos y después el ranking: con la base
 * lejos del servidor, cada viaje de ida y vuelta extra se nota.
 *
 * Sin sorteo activo devuelve 200 con `sorteo: null`; no es un error.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    const empresaId = ctx.auth.empresa_id;
    const sorteo = await sorteoActivoMasReciente(pool, schema, empresaId);
    if (!sorteo) {
      return NextResponse.json(successResponse({ sorteo: null, revendedores: [], totales: null }));
    }

    const data = await cargarRankingRevendedores(pool, schema, empresaId, sorteo.id);
    return NextResponse.json(successResponse({ sorteo, ...data }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[api/sorteos/revendedores/ranking-activo]", msg);
    return NextResponse.json(errorResponse("No se pudo cargar el ranking."), { status: 500 });
  }
}
