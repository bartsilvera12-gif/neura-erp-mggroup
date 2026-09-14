import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { resendSorteoTicketByDeliveryId } from "@/lib/sorteos/sorteo-ticket-delivery";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const { id } = await params;
    const sb = await getChatServiceClientForEmpresa(empresaId);

    /** Opcional: `{ n: [3] }` manda solo el boleto 3 de la compra. Sin cuerpo, los que no llegaron. */
    let soloN: number[] | undefined;
    try {
      const body = (await request.json()) as { n?: unknown };
      if (Array.isArray(body?.n)) {
        soloN = body.n.map(Number).filter((x) => Number.isInteger(x) && x >= 1);
      }
    } catch {
      soloN = undefined;
    }

    const r = await resendSorteoTicketByDeliveryId({
      supabase: sb,
      empresaId,
      deliveryId: id,
      soloN,
    });
    if (!r.ok) {
      const st =
        r.error === "not_found" ? 404 : r.error === "no_file" || r.error === "no_conversation" || r.error === "sin_imagenes"
            ? 400
            : 500;
      return NextResponse.json(errorResponse(r.error ?? "failed"), { status: st });
    }
    return NextResponse.json(
      successResponse({ ok: true, enviadas: r.enviadas ?? 0, numeros: r.numeros ?? [] })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
