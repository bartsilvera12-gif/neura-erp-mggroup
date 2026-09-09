import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import {
  getChatPostgresPool,
  isPgPoolExhaustionMessage,
  logPgPoolStats,
  quoteSchemaTable,
} from "@/lib/supabase/chat-pg-pool";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { invalidateSorteosListCachesForEmpresa } from "@/lib/sorteos/server-queries";

const LOG = "[sorteos-cupones][anular]";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

function sanitizeErr(msg: string): string {
  return msg.replace(/\b(password|token|secret|key)\s*=[^\s]+/gi, "[redacted]").slice(0, 280);
}

/**
 * POST /api/sorteos/cupones/[entradaId]/anular
 * Body: { motivo: string }
 *
 * Anula una venta ya registrada: la saca de los totales, de la rendición del vendedor y de la
 * impresión de cupones, que filtran por `confirmado`.
 *
 * Por qué es una ruta aparte de `estado-pago`: esa solo mueve desde `pendiente_revision` y esa
 * guarda es a propósito —resolver un pago no es lo mismo que deshacer una venta—. Anular parte
 * de una venta viva, casi siempre ya confirmada.
 *
 * Qué NO hace: borrar. Ni la venta ni los cupones. Quedan con `rechazado` y el motivo escrito
 * en `observacion_interna`, porque los números ya emitidos tienen que seguir siendo rastreables
 * —si el comprador aparece con el papel en la mano, hay que poder decirle qué pasó—.
 *
 * Los cupones de una venta anulada dejan de imprimirse, pero **los que ya se imprimieron y
 * están en la urna siguen físicamente ahí**: eso se resuelve en el mostrador, no acá.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entradaId: string }> }
) {
  try {
    const authCtx = await getTenantSupabaseFromAuth(request);
    if (!authCtx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const { entradaId: rawId } = await params;
    const entradaId = typeof rawId === "string" ? rawId.trim() : "";
    if (!entradaId || !isUuid(entradaId)) {
      return NextResponse.json(errorResponse("entradaId inválido."), { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { motivo?: unknown };
    const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
    /**
     * El motivo es obligatorio. Una venta anulada sin explicación es indistinguible de un
     * error, y estas anulaciones se miran justamente cuando la caja no cuadra.
     */
    if (motivo.length < 3) {
      return NextResponse.json(errorResponse("Escribí el motivo de la anulación."), {
        status: 400,
      });
    }

    const empresaId = authCtx.auth.empresa_id;
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const quien = authCtx.auth.user?.email ?? authCtx.auth.usuarioCatalogId ?? "usuario";
    const cuando = new Date();
    const rastro = `ANULADA ${cuando.toISOString().slice(0, 16).replace("T", " ")} por ${quien}: ${motivo.slice(0, 200)}`;

    console.info(LOG, {
      stage: "before",
      empresa_id: empresaId,
      schema: dataSchema,
      entrada_id: entradaId,
    });

    if (isLikelyUnexposedTenantChatSchema(dataSchema)) {
      const pool = getChatPostgresPool();
      if (!pool) {
        return NextResponse.json(
          errorResponse("El servidor no tiene conexión directa a Postgres."),
          { status: 503 }
        );
      }

      const qtbl = quoteSchemaTable(dataSchema, "sorteo_entradas");
      try {
        const r = await pool.query<{ id: string; numero_orden: number }>(
          `UPDATE ${qtbl}
              SET estado_pago = 'rechazado',
                  updated_at = $1::timestamptz,
                  observacion_interna =
                    COALESCE(NULLIF(observacion_interna, '') || E'\n', '') || $2::text
            WHERE id = $3::uuid
              AND empresa_id = $4::uuid
              AND estado_pago <> 'rechazado'
            RETURNING id, numero_orden`,
          [cuando.toISOString(), rastro, entradaId, empresaId]
        );
        const row = r.rows?.[0];
        if (!row) {
          /** O no existe, o ya estaba anulada: anular dos veces no es un error que valga alarma. */
          const cur = await pool.query<{ estado_pago: string }>(
            `SELECT estado_pago FROM ${qtbl} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
            [entradaId, empresaId]
          );
          if (!cur.rows?.[0]) {
            return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });
          }
          return NextResponse.json(errorResponse("Esta venta ya estaba anulada."), { status: 409 });
        }

        console.info(LOG, {
          stage: "ok",
          empresa_id: empresaId,
          schema: dataSchema,
          entrada_id: entradaId,
          numero_orden: row.numero_orden,
        });
        invalidateSorteosListCachesForEmpresa(empresaId, dataSchema);
        return NextResponse.json(
          successResponse({ entrada_id: entradaId, estado_pago: "rechazado" })
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const poolErr = isPgPoolExhaustionMessage(msg);
        if (poolErr) logPgPoolStats("cupones_anular", pool, { empresa_id: empresaId });
        console.error(LOG, {
          stage: "error",
          empresa_id: empresaId,
          schema: dataSchema,
          entrada_id: entradaId,
          error: sanitizeErr(msg),
        });
        return NextResponse.json(
          errorResponse(
            poolErr
              ? "Base de datos saturada momentáneamente; reintentá en unos segundos."
              : sanitizeErr(msg) || "Error al anular."
          ),
          { status: poolErr ? 503 : 500 }
        );
      }
    }

    const sb = authCtx.supabase;
    const { data: actual, error: readErr } = await sb
      .from("sorteo_entradas")
      .select("id, estado_pago, observacion_interna")
      .eq("id", entradaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (readErr) {
      return NextResponse.json(errorResponse(sanitizeErr(readErr.message)), { status: 500 });
    }
    if (!actual) {
      return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });
    }
    const fila = actual as { estado_pago?: string; observacion_interna?: string | null };
    if (String(fila.estado_pago ?? "") === "rechazado") {
      return NextResponse.json(errorResponse("Esta venta ya estaba anulada."), { status: 409 });
    }

    const previa = (fila.observacion_interna ?? "").trim();
    const { error: upErr } = await sb
      .from("sorteo_entradas")
      .update({
        estado_pago: "rechazado",
        updated_at: cuando.toISOString(),
        observacion_interna: previa ? `${previa}\n${rastro}` : rastro,
      })
      .eq("id", entradaId)
      .eq("empresa_id", empresaId);
    if (upErr) {
      return NextResponse.json(errorResponse(sanitizeErr(upErr.message)), { status: 500 });
    }

    invalidateSorteosListCachesForEmpresa(empresaId, dataSchema);
    return NextResponse.json(successResponse({ entrada_id: entradaId, estado_pago: "rechazado" }));
  } catch (e) {
    console.error(LOG, e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo anular la venta."), { status: 500 });
  }
}
