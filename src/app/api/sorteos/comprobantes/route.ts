import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { buscarComprobantesYCompras } from "@/lib/sorteos/comprobantes-compras-pg";
import type { EstadoFiltroComprobantes } from "@/lib/sorteos/comprobantes-compras-tipos";
import { rangoFechaChat } from "@/lib/chat/chat-filtro-fecha";

const ESTADOS: EstadoFiltroComprobantes[] = ["todos", "pendientes", "aprobados", "rechazados"];

/**
 * GET /api/sorteos/comprobantes?q=&estado=&fecha=&desde=&hasta=
 *
 * Comprobantes recibidos por WhatsApp con la compra y las boletas de cada uno; buscando a una
 * persona, también sus compras sin comprobante. `fecha` usa los mismos cortes que el filtro de
 * chats (hoy, ayer, semana, mes, rango), en días de Paraguay.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const pool = getChatPostgresPool();
    if (!pool) {
      return NextResponse.json(errorResponse("El servidor no tiene conexión directa a la base."), {
        status: 503,
      });
    }
    const empresaId = ctx.auth.empresa_id;
    const url = new URL(request.url);
    const estadoRaw = url.searchParams.get("estado")?.trim() as EstadoFiltroComprobantes | undefined;
    const estado = estadoRaw && ESTADOS.includes(estadoRaw) ? estadoRaw : "todos";
    const rango = rangoFechaChat(
      url.searchParams.get("fecha"),
      url.searchParams.get("desde"),
      url.searchParams.get("hasta")
    );

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const r = await buscarComprobantesYCompras(pool, schema, empresaId, {
      q: url.searchParams.get("q"),
      estado,
      desdeIso: rango?.desdeIso ?? null,
      hastaIso: rango?.hastaIso ?? null,
    });
    return NextResponse.json(successResponse(r));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/sorteos/comprobantes]", msg);
    return NextResponse.json(errorResponse(msg.slice(0, 300)), { status: 500 });
  }
}
