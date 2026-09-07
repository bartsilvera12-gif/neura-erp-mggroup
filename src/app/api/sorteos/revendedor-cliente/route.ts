import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { readRevendedorSession } from "@/lib/sorteos/revendedor-session";
import { posDesbloqueado } from "@/lib/sorteos/revendedor-pin-session";

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

    /** Mismo criterio que la venta: sin PIN no se consultan datos de compradores. */
    if (ctx.exigePin && !(await posDesbloqueado(ctx.revendedorId, ctx.pinActualizadoAt))) {
      return NextResponse.json(errorResponse("Ingresá tu PIN."), { status: 401 });
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
    const tClientes = quoteSchemaTable(schema, "clientes");
    const tFlowData = quoteSchemaTable(schema, "chat_flow_data");

    /*
     * La ciudad se busca en tres lugares, en orden: la venta (columna nueva), lo que la persona
     * contesto por WhatsApp y la ficha del cliente. Las ventas anteriores a la columna no la
     * tienen, y esas son justamente las que conviene recuperar del flujo o de la ficha.
     *
     * `to_jsonb(e) ->> 'ciudad'` en vez de `e.ciudad`: asi la consulta no se rompe si todavia
     * no se corrio la migracion que agrega la columna.
     */
    const r = await pool.query<{
      nombre_participante: string | null;
      whatsapp_numero: string | null;
      ciudad: string | null;
    }>(
      `SELECT e.nombre_participante,
              e.whatsapp_numero,
              COALESCE(
                NULLIF(TRIM(to_jsonb(e) ->> 'ciudad'), ''),
                (SELECT NULLIF(TRIM(fd.field_value), '')
                   FROM ${tFlowData} fd
                  WHERE fd.conversation_id = e.chat_conversation_id
                    AND fd.empresa_id = e.empresa_id
                    AND fd.field_name IN ('ciudad', 'localidad', 'ubicacion')
                    AND NULLIF(TRIM(fd.field_value), '') IS NOT NULL
                  ORDER BY fd.created_at DESC
                  LIMIT 1),
                NULLIF(TRIM(cl.ciudad), '')
              ) AS ciudad
         FROM ${tabla} e
         LEFT JOIN ${tClientes} cl ON cl.id = e.cliente_id AND cl.empresa_id = e.empresa_id
        WHERE e.empresa_id = $1::uuid
          AND e.sorteo_id = $2::uuid
          AND upper(regexp_replace(coalesce(e.documento, ''), '[^0-9A-Za-z]', '', 'g')) = $3
        ORDER BY e.created_at DESC
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
        ciudad: (row.ciudad ?? "").trim(),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[api/sorteos/revendedor-cliente]", msg);
    return NextResponse.json(errorResponse("No se pudo buscar el cliente."), { status: 500 });
  }
}
