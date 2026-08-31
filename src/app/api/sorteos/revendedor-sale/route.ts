import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import {
  readRevendedorSession,
  getRevendedorSaldo,
} from "@/lib/sorteos/revendedor-session";
import { createSorteoManualCashSaleViaDirectPostgres } from "@/lib/sorteos/sorteo-order-manual-pg";

export const dynamic = "force-dynamic";

/**
 * POST /api/sorteos/revendedor-sale — venta desde el POS del revendedor (link mágico).
 * Autenticado por la cookie de sesión del revendedor (no por usuario ERP).
 * Atribuye la venta a `revendedor_id` y respeta el cupo. Efectivo = confirmado;
 * transferencia = pendiente_revisión.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await readRevendedorSession();
    if (!ctx) {
      return NextResponse.json(
        errorResponse("Tu sesión de revendedor no es válida o fue revocada. Volvé a abrir tu link."),
        { status: 401 }
      );
    }
    if (ctx.sorteo.estado !== "activo") {
      return NextResponse.json(errorResponse("El sorteo no está activo."), { status: 403 });
    }
    if (!getChatPostgresPool()) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    const documento = typeof body.documento === "string" ? body.documento.trim() : "";
    const telefono = typeof body.telefono === "string" ? body.telefono.trim() : "";
    const idem = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
    const pagoMetodo: "efectivo" | "transferencia" =
      body.pago_metodo === "transferencia" ? "transferencia" : "efectivo";
    const cantidad = Number(body.cantidad);

    if (!nombre) {
      return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    }
    if (!telefono) {
      return NextResponse.json(errorResponse("El teléfono es obligatorio."), { status: 400 });
    }
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      return NextResponse.json(errorResponse("La cantidad debe ser mayor a 0."), { status: 400 });
    }
    if (!idem) {
      return NextResponse.json(errorResponse("Falta idempotency_key."), { status: 400 });
    }

    const qty = Math.floor(cantidad);

    // Cupo del revendedor
    if (ctx.cupoBoletos != null) {
      const saldo = await getRevendedorSaldo(ctx);
      if (saldo.cupoRestante != null && qty > saldo.cupoRestante) {
        return NextResponse.json(
          errorResponse(`Cupo insuficiente: te quedan ${saldo.cupoRestante} boleto(s).`),
          { status: 409 }
        );
      }
    }

    const monto = qty * ctx.sorteo.precioPorBoleto;
    const schema = getSingleClientSchemaOrNull();
    if (!schema) {
      return NextResponse.json(errorResponse("Instancia sin schema de cliente configurado."), { status: 500 });
    }

    const created = await createSorteoManualCashSaleViaDirectPostgres({
      schema,
      empresaId: ctx.empresaId,
      sorteoId: ctx.sorteoId,
      idempotencyKey: idem,
      nombre,
      apellido: "",
      cedula: documento,
      telefono,
      cantidadBoletos: qty,
      montoTotal: monto,
      revendedorId: ctx.revendedorId,
      pagoMetodo,
      // venta_origen/venta_canal tienen CHECK (erp_manual|whatsapp_flow / local|remote):
      // la venta del revendedor se identifica por revendedor_id + validado_por.
      validadoPor: pagoMetodo === "efectivo" ? "revendedor_efectivo" : "revendedor_transferencia",
    });

    if (!created.ok) {
      return NextResponse.json(errorResponse(created.message), { status: 400 });
    }

    return NextResponse.json(
      successResponse({
        entrada_id: created.entradaId,
        numero_orden: created.numeroOrden,
        idempotent: created.idempotent,
        cupones: created.cupones,
        estado_pago: created.estadoPago,
        monto_total: created.montoTotal,
        cantidad: created.cantidadBoletos,
        pago_metodo: pagoMetodo,
        sorteo_nombre: ctx.sorteo.nombre,
        revendedor_nombre: ctx.nombre,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
