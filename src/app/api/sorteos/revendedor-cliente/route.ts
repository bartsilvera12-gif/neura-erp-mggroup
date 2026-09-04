import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { readRevendedorSession } from "@/lib/sorteos/revendedor-session";

export const dynamic = "force-dynamic";

/** Solo dígitos y letras: las cédulas se escriben con puntos, guiones o espacios indistintamente. */
function soloAlfanumerico(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * GET /api/sorteos/revendedor-cliente?documento=1234567
 *
 * Autocompleta al comprador en el POS del revendedor a partir de sus compras anteriores en
 * este sorteo. Autenticado por la cookie de sesión del revendedor, igual que la venta, y
 * acotado a la empresa y al sorteo de esa sesión: un revendedor no puede usar esto para
 * listar clientes de otro sorteo ni de otra empresa.
 *
 * Devuelve 200 con `encontrado: false` cuando no hay compra previa; no es un error.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await readRevendedorSession();
    if (!ctx) {
      return NextResponse.json(
        errorResponse("Tu sesión de revendedor no es válida o fue revocada. Volvé a abrir tu link."),
        { status: 401 }
      );
    }

    const documentoRaw = request.nextUrl.searchParams.get("documento") ?? "";
    const documento = soloAlfanumerico(documentoRaw);
    /** Menos de 4 caracteres devolvería medio padrón mientras la persona todavía tipea. */
    if (documento.length < 4) {
      return NextResponse.json(successResponse({ encontrado: false }));
    }

    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    const tabla = quoteSchemaTable(schema, "sorteo_entradas");
    const r = await pool.query<{ nombre_participante: string | null; whatsapp_numero: string | null }>(
      `SELECT nombre_participante, whatsapp_numero
         FROM ${tabla}
        WHERE empresa_id = $1::uuid
          AND sorteo_id = $2::uuid
          AND upper(regexp_replace(coalesce(documento, ''), '[^0-9A-Za-z]', '', 'g')) = $3
        ORDER BY created_at DESC
        LIMIT 1`,
      [ctx.empresaId, ctx.sorteoId, documento]
    );

    const row = r.rows[0];
    if (!row) {
      return NextResponse.json(successResponse({ encontrado: false }));
    }

    return NextResponse.json(
      successResponse({
        encontrado: true,
        nombre: (row.nombre_participante ?? "").trim(),
        telefono: (row.whatsapp_numero ?? "").trim(),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[api/sorteos/revendedor-cliente]", msg);
    return NextResponse.json(errorResponse("No se pudo buscar el cliente."), { status: 500 });
  }
}
