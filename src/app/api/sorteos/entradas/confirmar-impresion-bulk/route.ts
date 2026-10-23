import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  confirmarImpresionCuponesEntradasBulk,
  CONFIRMAR_IMPRESION_BULK_MAX,
} from "@/lib/sorteos/sorteo-entrada-confirmar-impresion-bulk";
import { invalidateSorteosListCachesForEmpresa } from "@/lib/sorteos/server-queries";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * POST /api/sorteos/entradas/confirmar-impresion-bulk
 * Body: { sorteo_id: string, entrada_ids: string[] }
 * Marca como impresas todas las órdenes indicadas (impresión en tanda).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    let body: { sorteo_id?: string; entrada_ids?: unknown };
    try {
      body = (await request.json()) as { sorteo_id?: string; entrada_ids?: unknown };
    } catch {
      return NextResponse.json(errorResponse("JSON inválido"), { status: 400 });
    }

    const sorteoId = typeof body.sorteo_id === "string" ? body.sorteo_id.trim() : "";
    if (!isUuid(sorteoId)) {
      return NextResponse.json(errorResponse("sorteo_id requerido e inválido"), { status: 400 });
    }

    const rawIds = Array.isArray(body.entrada_ids) ? body.entrada_ids : [];
    const entradaIds = [
      ...new Set(rawIds.map((v) => String(v).trim()).filter(Boolean)),
    ];
    if (entradaIds.length === 0) {
      return NextResponse.json(errorResponse("entrada_ids requerido (lista no vacía)"), { status: 400 });
    }
    if (entradaIds.length > CONFIRMAR_IMPRESION_BULK_MAX) {
      return NextResponse.json(
        errorResponse(
          `No se pueden marcar más de ${CONFIRMAR_IMPRESION_BULK_MAX} órdenes a la vez. Acotá por fecha o búsqueda.`
        ),
        { status: 400 }
      );
    }

    const empresaId = ctx.auth.empresa_id;
    const catalogId = ctx.auth.usuarioCatalogId;
    const authUserId = ctx.auth.user?.id;
    const usuarioUuid =
      typeof catalogId === "string" && isUuid(catalogId)
        ? catalogId
        : typeof authUserId === "string" && isUuid(authUserId)
          ? authUserId
          : null;

    const result = await confirmarImpresionCuponesEntradasBulk({
      empresaId,
      usuarioUuid,
      sorteoId,
      entradaIds,
    });

    if (!result.ok) {
      return NextResponse.json(errorResponse(result.message), { status: result.status });
    }

    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    invalidateSorteosListCachesForEmpresa(empresaId, dataSchema);

    return NextResponse.json(
      successResponse({
        entradas_marcadas: result.entradas_marcadas,
        cupones_impresos_at: result.cupones_impresos_at,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
