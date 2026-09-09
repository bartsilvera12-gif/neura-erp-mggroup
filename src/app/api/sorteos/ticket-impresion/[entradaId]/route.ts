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
import {
  buildSorteoTicketQrPayload,
  renderSorteoTicketQrDataUrl,
} from "@/lib/sorteos/sorteo-ticket-qr";
import { sorteoLogoPublicUrl } from "@/lib/sorteos/sorteo-ticket-storage";

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

    /*
     * Sin logo configurado para la impresora, se usa el del sorteo —el mismo que sale en la
     * boleta de WhatsApp—. El campo de Configuracion → Ticket sigue mandando cuando esta
     * cargado, por si alguien quiere un logo distinto en el papel.
     *
     * Eran dos configuraciones para el mismo logo, y la del papel pedia una URL escrita a mano
     * que nadie llenaba: la boleta salia sin logo mientras la digital lo mostraba bien.
     */
    const cfgConLogo = cfg.logo_url
      ? cfg
      : { ...cfg, logo_url: (await sorteoLogoPublicUrl(empresaId, datos.sorteo_id)) ?? "" };

    /*
     * Un QR por número, con el mismo contenido que el del comprobante de WhatsApp: en la puerta
     * del sorteo se escanea el boleto de papel o la imagen del celular y tiene que leerse lo
     * mismo. Se arma acá y no en el navegador porque el payload lo define el servidor.
     *
     * Si el render falla, el ticket sale sin QR. Vale igual: lleva el número impreso.
     */
    const qrPorCupon: Record<string, string> = {};
    await Promise.all(
      datos.cupones.map(async (numero) => {
        const payload = buildSorteoTicketQrPayload({
          numeroOrden: datos.numero_orden,
          cupones: [numero],
          clienteNombre: datos.cliente,
          documento: datos.documento,
          telefono: datos.telefono,
          ciudad: datos.ciudad,
          sorteoNombre: datos.sorteo_nombre,
        });
        const url = await renderSorteoTicketQrDataUrl(payload, 320);
        if (url) qrPorCupon[numero] = url;
      })
    );

    return NextResponse.json(successResponse({ cfg: cfgConLogo, datos: { ...datos, qr_por_cupon: qrPorCupon } }));
  } catch (e) {
    console.error("[api/sorteos/ticket-impresion]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo cargar el ticket."), { status: 500 });
  }
}
