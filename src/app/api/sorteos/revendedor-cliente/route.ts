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

/** Últimos 8 dígitos del teléfono: así matchea aunque varíe el prefijo de país (0981 vs +595 981). */
function ultimos8(telefono: string): string {
  const d = telefono.replace(/\D/g, "");
  return d.length > 8 ? d.slice(-8) : d;
}

/**
 * GET /api/sorteos/revendedor-cliente?documento=1234567&telefono=0981...
 *
 * Autocompleta al comprador en el POS del revendedor a partir de sus compras anteriores. Se
 * puede buscar por documento, por teléfono (celular) o por ambos: en la calle muchos
 * compradores dan solo el celular, así que no alcanzaba con el documento.
 *
 * La búsqueda es ENTRE EDICIONES: toma la última compra de esa persona en cualquier sorteo de
 * la empresa, no solo en el sorteo activo. El cliente que compró en una edición anterior no
 * tiene que volver a cargar sus datos en la edición nueva. Sigue acotada a la empresa de la
 * sesión: un revendedor no puede listar clientes de otra empresa.
 *
 * Autenticado por la cookie de sesión del revendedor, igual que la venta.
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
    const telefonoRaw = request.nextUrl.searchParams.get("telefono") ?? "";
    const documento = soloAlfanumerico(documentoRaw);
    const telefono8 = ultimos8(telefonoRaw);
    /**
     * Umbrales para no devolver medio padrón mientras la persona todavía tipea: el documento
     * necesita al menos 4 caracteres y el teléfono, 8 dígitos (el número local completo).
     */
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
          AND NULLIF(TRIM(COALESCE(e.nombre_participante, '')), '') IS NOT NULL
          AND (
            ($2 <> '' AND upper(regexp_replace(coalesce(e.documento, ''), '[^0-9A-Za-z]', '', 'g')) = $2)
            OR
            ($3 <> '' AND right(regexp_replace(coalesce(e.whatsapp_numero, ''), '\\D', '', 'g'), 8) = $3)
          )
        ORDER BY e.created_at DESC
        LIMIT 1`,
      [ctx.empresaId, buscaDoc ? documento : "", buscaTel ? telefono8 : ""]
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
    console.error("[api/sorteos/revendedor-cliente]", msg);
    return NextResponse.json(errorResponse("No se pudo buscar el cliente."), { status: 500 });
  }
}
