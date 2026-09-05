import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { actualizarVendedor } from "@/lib/sorteos/vendedores-admin-pg";
import { generarPin, validarPinElegido } from "@/lib/sorteos/vendedor-pin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/vendedores/:id — editar datos, estado o PIN.
 *
 * `numero_vendedor` no es editable: sale impreso en tickets y queda registrado en los cierres
 * de caja, así que cambiarlo rompería la trazabilidad hacia atrás.
 *
 * Con `regenerar_pin: true` se devuelve el nuevo PIN una única vez.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ vendedorId: string }> }
) {
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

    const { vendedorId } = await params;
    const id = vendedorId.trim();
    if (!id) return NextResponse.json(errorResponse("Vendedor inválido."), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let pinNuevo: string | undefined;
    if (typeof body.pin === "string" && body.pin.trim()) {
      const v = validarPinElegido(body.pin);
      if (!v.ok) return NextResponse.json(errorResponse(v.motivo), { status: 400 });
      pinNuevo = body.pin.trim();
    } else if (body.regenerar_pin === true) {
      pinNuevo = generarPin();
    }

    const cupoRaw = body.cupo_boletos;
    const cupo =
      cupoRaw === undefined
        ? undefined
        : cupoRaw == null || String(cupoRaw).trim() === ""
          ? null
          : Math.trunc(Number(cupoRaw));
    if (cupo != null && cupo !== undefined && (!Number.isFinite(cupo) || cupo < 0)) {
      return NextResponse.json(errorResponse("El cupo debe ser un número mayor o igual a 0."), {
        status: 400,
      });
    }

    const res = await actualizarVendedor(pool, schema, ctx.auth.empresa_id, id, {
      nombre: typeof body.nombre === "string" ? body.nombre : undefined,
      cargo: typeof body.cargo === "string" ? body.cargo : undefined,
      telefono: typeof body.telefono === "string" ? body.telefono : undefined,
      activo: typeof body.activo === "boolean" ? body.activo : undefined,
      cupoBoletos: cupo,
      pin: pinNuevo,
    });
    if (!res.ok) return NextResponse.json(errorResponse(res.message), { status: 400 });

    return NextResponse.json(
      successResponse({ vendedor: res.vendedor, ...(pinNuevo ? { pin: pinNuevo } : {}) })
    );
  } catch (e) {
    console.error("[api/vendedores/:id][PATCH]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo guardar el vendedor."), { status: 500 });
  }
}
