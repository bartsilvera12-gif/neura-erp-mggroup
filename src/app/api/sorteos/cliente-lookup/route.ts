import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";

export const dynamic = "force-dynamic";

/** Solo dígitos y letras: las cédulas se escriben con puntos, guiones o espacios indistintamente. */
function soloAlfanumerico(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Últimos 8 dígitos del teléfono: matchea aunque varíe el prefijo de país (0981 vs +595 981). */
function ultimos8(telefono: string): string {
  const d = telefono.replace(/\D/g, "");
  return d.length > 8 ? d.slice(-8) : d;
}

/**
 * GET /api/sorteos/cliente-lookup?documento=1234567&telefono=0981...
 *
 * Autocompleta al comprador en la venta presencial del admin a partir de sus compras
 * anteriores, buscándolo por documento o por celular y en CUALQUIER edición de la empresa (no
 * solo el sorteo activo). Es el equivalente a `/api/sorteos/revendedor-cliente`, pero
 * autenticado como usuario de la empresa en vez de por la sesión del revendedor.
 *
 * Devuelve 200 con `encontrado: false` cuando no hay compra previa; no es un error.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const documento = soloAlfanumerico(request.nextUrl.searchParams.get("documento") ?? "");
    const telefono8 = ultimos8(request.nextUrl.searchParams.get("telefono") ?? "");
    const buscaDoc = documento.length >= 4;
    const buscaTel = telefono8.length >= 8;
    if (!buscaDoc && !buscaTel) {
      return NextResponse.json(successResponse({ encontrado: false }));
    }

    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
    const tCli = quoteSchemaTable(schema, "clientes");
    const tFd = quoteSchemaTable(schema, "chat_flow_data");

    const r = await pool.query<{
      nombre_participante: string | null;
      documento: string | null;
      whatsapp_numero: string | null;
      ciudad: string | null;
    }>(
      `SELECT e.nombre_participante,
              e.documento,
              e.whatsapp_numero,
              COALESCE(
                NULLIF(TRIM(to_jsonb(e) ->> 'ciudad'), ''),
                (SELECT NULLIF(TRIM(fd.field_value), '')
                   FROM ${tFd} fd
                  WHERE fd.conversation_id = e.chat_conversation_id
                    AND fd.empresa_id = e.empresa_id
                    AND fd.field_name IN ('ciudad', 'localidad', 'ubicacion')
                    AND NULLIF(TRIM(fd.field_value), '') IS NOT NULL
                  ORDER BY fd.created_at DESC
                  LIMIT 1),
                NULLIF(TRIM(cl.ciudad), '')
              ) AS ciudad
         FROM ${tEnt} e
         LEFT JOIN ${tCli} cl ON cl.id = e.cliente_id AND cl.empresa_id = e.empresa_id
        WHERE e.empresa_id = $1::uuid
          AND NULLIF(TRIM(COALESCE(e.nombre_participante, '')), '') IS NOT NULL
          AND (
            ($2 <> '' AND upper(regexp_replace(coalesce(e.documento, ''), '[^0-9A-Za-z]', '', 'g')) = $2)
            OR
            ($3 <> '' AND right(regexp_replace(coalesce(e.whatsapp_numero, ''), '\\D', '', 'g'), 8) = $3)
          )
        ORDER BY e.created_at DESC
        LIMIT 1`,
      [ctx.auth.empresa_id, buscaDoc ? documento : "", buscaTel ? telefono8 : ""]
    );

    const row = r.rows[0];
    if (!row) {
      return NextResponse.json(successResponse({ encontrado: false }));
    }

    return NextResponse.json(
      successResponse({
        encontrado: true,
        nombre: (row.nombre_participante ?? "").trim(),
        documento: (row.documento ?? "").trim(),
        telefono: (row.whatsapp_numero ?? "").trim(),
        ciudad: (row.ciudad ?? "").trim(),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[api/sorteos/cliente-lookup]", msg);
    return NextResponse.json(errorResponse("No se pudo buscar el cliente."), { status: 500 });
  }
}
