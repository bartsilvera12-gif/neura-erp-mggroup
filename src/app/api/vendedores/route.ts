import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { crearVendedor, listarVendedores } from "@/lib/sorteos/vendedores-admin-pg";
import { generarPin, validarPinElegido } from "@/lib/sorteos/vendedor-pin";

export const dynamic = "force-dynamic";

function contexto() {
  const pool = getChatPostgresPool();
  const schema = getSingleClientSchemaOrNull();
  return pool && schema ? { pool, schema } : null;
}

/** GET /api/vendedores — listado del panel de gestión. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const c = contexto();
    if (!c) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }
    const vendedores = await listarVendedores(c.pool, c.schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ vendedores }));
  } catch (e) {
    console.error("[api/vendedores][GET]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo cargar el listado."), { status: 500 });
  }
}

/** Código de referido a partir del nombre, si el administrador no escribe uno. */
function codigoDesdeNombre(nombre: string, numeroTentativo: number): string {
  const base = nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return base ? `${base}-${numeroTentativo}` : `vendedor-${numeroTentativo}`;
}

/**
 * POST /api/vendedores — alta.
 *
 * El PIN se devuelve UNA sola vez en la respuesta, para que el administrador se lo pase al
 * vendedor. Después queda solo el hash: no hay forma de recuperarlo, únicamente de generar
 * otro. Es a propósito.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const c = contexto();
    if (!c) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) {
      return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    }

    /** PIN elegido por el administrador o generado; nunca queda vacío. */
    let pin: string;
    if (typeof body.pin === "string" && body.pin.trim()) {
      const v = validarPinElegido(body.pin);
      if (!v.ok) return NextResponse.json(errorResponse(v.motivo), { status: 400 });
      pin = body.pin.trim();
    } else {
      pin = generarPin();
    }

    const cupoRaw = body.cupo_boletos;
    const cupo =
      cupoRaw == null || String(cupoRaw).trim() === "" ? null : Math.trunc(Number(cupoRaw));
    if (cupo != null && (!Number.isFinite(cupo) || cupo < 0)) {
      return NextResponse.json(errorResponse("El cupo debe ser un número mayor o igual a 0."), {
        status: 400,
      });
    }

    const codigo =
      typeof body.codigo_referido === "string" && body.codigo_referido.trim()
        ? body.codigo_referido.trim()
        : codigoDesdeNombre(nombre, Date.now() % 100000);

    const res = await crearVendedor(c.pool, c.schema, ctx.auth.empresa_id, {
      nombre,
      cargo: typeof body.cargo === "string" ? body.cargo : null,
      telefono: typeof body.telefono === "string" ? body.telefono : null,
      codigoReferido: codigo,
      activo: body.activo !== false,
      cupoBoletos: cupo,
      pin,
    });
    if (!res.ok) return NextResponse.json(errorResponse(res.message), { status: 400 });

    return NextResponse.json(successResponse({ vendedor: res.vendedor, pin }));
  } catch (e) {
    console.error("[api/vendedores][POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo crear el vendedor."), { status: 500 });
  }
}
