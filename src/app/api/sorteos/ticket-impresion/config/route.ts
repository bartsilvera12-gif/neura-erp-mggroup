import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { guardarConfigTicket, leerConfigTicket } from "@/lib/sorteos/ticket-impresion-pg";
import { CONFIG_TICKET_DEFECTO } from "@/lib/sorteos/ticket-impresion-tipos";

export const dynamic = "force-dynamic";

function entorno() {
  const pool = getChatPostgresPool();
  const schema = getSingleClientSchemaOrNull();
  return pool && schema ? { pool, schema } : null;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const e = entorno();
    if (!e) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }
    const cfg = await leerConfigTicket(e.pool, e.schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ cfg }));
  } catch (err) {
    console.error("[api/ticket-impresion/config][GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la configuración."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const e = entorno();
    if (!e) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ancho = Number(body.ancho_mm);
    if (ancho !== 58 && ancho !== 80) {
      return NextResponse.json(errorResponse("El ancho debe ser 58 o 80 mm."), { status: 400 });
    }
    const copias = Math.trunc(Number(body.copias ?? 1));
    if (!Number.isFinite(copias) || copias < 1 || copias > 3) {
      return NextResponse.json(errorResponse("Las copias deben ser entre 1 y 3."), { status: 400 });
    }

    const texto = (k: string, max: number): string =>
      typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "";

    const cfg = await guardarConfigTicket(e.pool, e.schema, ctx.auth.empresa_id, {
      ...CONFIG_TICKET_DEFECTO,
      ancho_mm: ancho,
      negocio_nombre: texto("negocio_nombre", 60),
      logo_url: texto("logo_url", 500),
      /** Se limitan a lo que entra en un rollo sin volverse un panfleto. */
      encabezado: texto("encabezado", 200),
      pie: texto("pie", 200),
      mostrar_telefono: body.mostrar_telefono !== false,
      mostrar_vendedor: body.mostrar_vendedor !== false,
      copias,
    });

    return NextResponse.json(successResponse({ cfg }));
  } catch (err) {
    console.error("[api/ticket-impresion/config][PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la configuración."), {
      status: 500,
    });
  }
}
