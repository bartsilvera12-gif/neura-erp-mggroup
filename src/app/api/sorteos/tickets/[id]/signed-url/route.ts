import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createSignedUrlForTicket } from "@/lib/sorteos/sorteo-ticket-storage";
import { rutaDeImagenDeBoleto } from "@/lib/sorteos/sorteo-ticket-imagenes";

export async function GET(
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
    const url = new URL(request.url);
    const ttl = Math.min(Math.max(Number(url.searchParams.get("ttl") ?? "600"), 60), 3600);
    /** `?n=3`: la foto del boleto 3 de la compra. Sin esto, la primera. */
    const n = Number(url.searchParams.get("n") ?? "1");

    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data: row, error } = await sb
      .from("sorteo_ticket_deliveries")
      .select("storage_path, empresa_id, payload_snapshot")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json(errorResponse("No encontrado"), { status: 404 });
    }
    const fila = row as { storage_path?: string | null; payload_snapshot?: unknown };
    if (!fila.storage_path?.trim()) {
      return NextResponse.json(errorResponse("Sin archivo generado"), { status: 400 });
    }
    const path = Number.isInteger(n) && n >= 1
      ? rutaDeImagenDeBoleto(fila.payload_snapshot, fila.storage_path, n)
      : null;
    if (!path) {
      return NextResponse.json(errorResponse("Esa compra no tiene ese boleto"), { status: 404 });
    }
    const signed = await createSignedUrlForTicket(sb, path, ttl);
    if (!signed.url) {
      return NextResponse.json(errorResponse(signed.error ?? "signed_url"), { status: 500 });
    }
    return NextResponse.json(successResponse({ url: signed.url, expires_in: ttl }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
