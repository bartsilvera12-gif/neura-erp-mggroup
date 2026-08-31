import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { generateRevendedorAccessToken } from "@/lib/sorteos/revendedor-access";

/**
 * POST /api/sorteos/revendedores/:revId/access-link
 *   Genera (o rota) el link mágico del revendedor. Revoca el token anterior implícitamente
 *   al reemplazarlo. Devuelve el revendedor con su nuevo `access_token`.
 *
 * DELETE /api/sorteos/revendedores/:revId/access-link
 *   Revoca el acceso (marca `access_revoked_at`); el token deja de ser válido.
 */

async function authAndId(
  request: NextRequest,
  params: Promise<{ revId: string }>
): Promise<{ empresaId: string; id: string } | { error: NextResponse }> {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) {
    return { error: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) };
  }
  const { revId } = await params;
  const id = revId.trim();
  if (!id) {
    return { error: NextResponse.json(errorResponse("Revendedor inválido."), { status: 400 }) };
  }
  return { empresaId: ctx.auth.empresa_id, id };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ revId: string }> }) {
  try {
    const a = await authAndId(request, params);
    if ("error" in a) return a.error;

    const token = generateRevendedorAccessToken();
    const nowIso = new Date().toISOString();

    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const { data, error } = await sb
      .from("sorteo_revendedores")
      .update({
        access_token: token,
        access_token_created_at: nowIso,
        access_revoked_at: null,
        updated_at: nowIso,
      })
      .eq("id", a.id)
      .eq("empresa_id", a.empresaId)
      .select("id, nombre, access_token, access_token_created_at, access_revoked_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Revendedor no encontrado."), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ revId: string }> }) {
  try {
    const a = await authAndId(request, params);
    if ("error" in a) return a.error;

    const nowIso = new Date().toISOString();
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const { data, error } = await sb
      .from("sorteo_revendedores")
      .update({ access_revoked_at: nowIso, updated_at: nowIso })
      .eq("id", a.id)
      .eq("empresa_id", a.empresaId)
      .select("id, nombre, access_revoked_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Revendedor no encontrado."), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
