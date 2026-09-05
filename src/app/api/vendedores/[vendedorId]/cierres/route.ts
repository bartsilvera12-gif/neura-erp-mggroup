import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import {
  listarCierres,
  operacionesDelPeriodo,
  realizarCierre,
} from "@/lib/sorteos/cierre-caja-pg";

export const dynamic = "force-dynamic";

function entorno() {
  const pool = getChatPostgresPool();
  const schema = getSingleClientSchemaOrNull();
  return pool && schema ? { pool, schema } : null;
}

/**
 * Rango pedido, en ISO. `desde` toma el arranque del día y `hasta` el final, porque el
 * formulario manda fechas sin hora y un `hasta` a medianoche dejaría afuera todo ese día.
 */
function rango(sp: URLSearchParams | Record<string, unknown>): { desde: string; hasta: string } {
  const leer = (k: string): string => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : (sp as Record<string, unknown>)[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const d = leer("desde");
  const h = leer("hasta");
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : d || `${hoy}T00:00:00.000Z`;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(h) ? `${h}T23:59:59.999Z` : h || `${hoy}T23:59:59.999Z`;
  return { desde, hasta };
}

/** GET — operaciones del período + cierres ya realizados. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vendedorId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const e = entorno();
    if (!e) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }
    const { vendedorId } = await params;
    const id = vendedorId.trim();
    if (!id) return NextResponse.json(errorResponse("Vendedor inválido."), { status: 400 });

    const { desde, hasta } = rango(request.nextUrl.searchParams);
    const [detalle, cierres] = await Promise.all([
      operacionesDelPeriodo(e.pool, e.schema, ctx.auth.empresa_id, id, desde, hasta),
      listarCierres(e.pool, e.schema, ctx.auth.empresa_id, id),
    ]);

    return NextResponse.json(successResponse({ periodo: { desde, hasta }, ...detalle, cierres }));
  } catch (err) {
    console.error("[api/vendedores/:id/cierres][GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el período."), { status: 500 });
  }
}

/** POST — realiza el cierre de caja del período. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vendedorId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const e = entorno();
    if (!e) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }
    const { vendedorId } = await params;
    const id = vendedorId.trim();
    if (!id) return NextResponse.json(errorResponse("Vendedor inválido."), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { desde, hasta } = rango(body);

    const res = await realizarCierre(e.pool, e.schema, {
      empresaId: ctx.auth.empresa_id,
      revendedorId: id,
      desdeIso: desde,
      hastaIso: hasta,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      /** Se guarda el nombre además del id: el usuario puede cambiar o borrarse. */
      usuarioNombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null,
      observacion: typeof body.observacion === "string" ? body.observacion : null,
    });
    if (!res.ok) return NextResponse.json(errorResponse(res.message), { status: 400 });

    return NextResponse.json(successResponse({ cierre: res.cierre }));
  } catch (err) {
    console.error("[api/vendedores/:id/cierres][POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo realizar el cierre."), { status: 500 });
  }
}
