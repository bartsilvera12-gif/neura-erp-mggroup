import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { readRevendedorSession } from "@/lib/sorteos/revendedor-session";
import { posDesbloqueado } from "@/lib/sorteos/revendedor-pin-session";
import {
  entradaEsDelRevendedor,
  leerConfigTicket,
  leerDatosTicket,
} from "@/lib/sorteos/ticket-impresion-pg";

export const dynamic = "force-dynamic";

/**
 * GET /api/sorteos/ticket-impresion/:entradaId
 *
 * Datos para imprimir (o reimprimir) el ticket de una venta ya registrada. Nunca crea nada:
 * reimprimir da exactamente el mismo ticket, con el mismo número.
 *
 * Dos formas de entrar: el vendedor por su sesión de POS, y solo sobre SUS ventas; o un
 * usuario del ERP, sobre cualquier venta de su empresa.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entradaId: string }> }
) {
  try {
    const { entradaId } = await params;
    const id = entradaId.trim();
    if (!id) return NextResponse.json(errorResponse("Venta inválida."), { status: 400 });

    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    let empresaId: string | null = null;

    const rv = await readRevendedorSession();
    if (rv) {
      if (rv.exigePin && !(await posDesbloqueado(rv.revendedorId, rv.pinActualizadoAt))) {
        return NextResponse.json(errorResponse("Ingresá tu PIN."), { status: 401 });
      }
      /** Un vendedor solo reimprime lo suyo: si no, con cambiar el id vería ventas ajenas. */
      if (!(await entradaEsDelRevendedor(pool, schema, id, rv.revendedorId))) {
        return NextResponse.json(errorResponse("Ese ticket no es tuyo."), { status: 403 });
      }
      empresaId = rv.empresaId;
    } else {
      const ctx = await getTenantSupabaseFromAuth(request);
      if (!ctx) {
        return NextResponse.json(errorResponse("No autorizado."), { status: 401 });
      }
      empresaId = ctx.auth.empresa_id;
    }

    const [cfg, datos] = await Promise.all([
      leerConfigTicket(pool, schema, empresaId),
      leerDatosTicket(pool, schema, empresaId, id),
    ]);
    if (!datos) {
      return NextResponse.json(errorResponse("No encontramos esa venta."), { status: 404 });
    }

    return NextResponse.json(successResponse({ cfg, datos }));
  } catch (e) {
    console.error("[api/sorteos/ticket-impresion]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo cargar el ticket."), { status: 500 });
  }
}
