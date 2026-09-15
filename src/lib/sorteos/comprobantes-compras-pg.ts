import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import {
  esComprobantePendiente,
  prepararBusqueda,
  type EstadoFiltroComprobantes,
  type FilaComprobanteCompra,
  type ResumenBusqueda,
} from "@/lib/sorteos/comprobantes-compras-tipos";

export type { EstadoFiltroComprobantes, FilaComprobanteCompra, ResumenBusqueda };

/**
 * Comprobantes y compras, para revisarlos a mano y para ver todo lo de una persona.
 *
 * Cada fila es un comprobante que llegó por WhatsApp, con la compra y las boletas que generó
 * (si generó alguna), o una compra que no vino con comprobante (vendedor, ERP). Así, buscando
 * a alguien, aparece todo lo que mandó y todo lo que tiene, incluso los comprobantes que
 * quedaron en revisión y nunca dieron boletas: ese es el caso de quien «pagó y no encuentra
 * sus boletas».
 *
 * Columnas opcionales (montos esperados, datos de aprobación manual, número de orden) se leen
 * con `to_jsonb(...) ->> 'col'`: hay esquemas donde no existen y nombrarlas directo rompería la
 * consulta entera.
 */

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

export async function buscarComprobantesYCompras(
  pool: Pool,
  schema: string,
  empresaId: string,
  opciones: {
    q?: string | null;
    estado?: EstadoFiltroComprobantes;
    desdeIso?: string | null;
    hastaIso?: string | null;
    limite?: number;
  } = {}
): Promise<{ filas: FilaComprobanteCompra[]; resumen: ResumenBusqueda; truncado: boolean }> {
  const tVal = quoteSchemaTable(schema, "chat_comprobante_validaciones");
  const tConv = quoteSchemaTable(schema, "chat_conversations");
  const tCont = quoteSchemaTable(schema, "chat_contacts");
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");
  const tSor = quoteSchemaTable(schema, "sorteos");
  const tFd = quoteSchemaTable(schema, "chat_flow_data");

  const limite = Math.min(Math.max(opciones.limite ?? 150, 1), 500);
  const estado = opciones.estado ?? "todos";
  const { texto, digitos, ultimos8 } = prepararBusqueda(opciones.q);
  const like = texto ? `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  /**
   * $1 empresa, $2 texto (ILIKE), $3 dígitos exactos, $4 últimos 8 del teléfono,
   * $5 desde, $6 hasta, $7 límite.
   */
  const params = [
    empresaId,
    like,
    digitos,
    ultimos8,
    opciones.desdeIso ?? null,
    opciones.hastaIso ?? null,
    limite + 1,
  ];

  const tel = (col: string) => `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 8)`;

  /** Coincidencias de una compra: datos del participante, orden y boletas. */
  const coincideCompra = (e: string) => `(
       ($2::text IS NOT NULL AND (${e}.nombre_participante ILIKE $2 OR ${e}.documento ILIKE $2))
    OR ($3::text IS NOT NULL AND (
          regexp_replace(COALESCE(${e}.documento, ''), '\\D', '', 'g') = $3
       OR (to_jsonb(${e}) ->> 'numero_orden') = $3
       OR EXISTS (SELECT 1 FROM ${tCup} c WHERE c.entrada_id = ${e}.id AND c.numero_cupon = $3)))
    OR ($4::text IS NOT NULL AND ${tel(`${e}.whatsapp_numero`)} = $4)
  )`;

  const filtroEstado =
    estado === "pendientes"
      ? `AND v.sorteo_entrada_id IS NULL
         AND v.estado_validacion NOT IN ('valido', 'aprobado_manual', 'rechazado_manual')`
      : estado === "aprobados"
        ? `AND (v.estado_validacion IN ('valido', 'aprobado_manual') OR v.sorteo_entrada_id IS NOT NULL)
           AND v.estado_validacion <> 'rechazado_manual'`
        : estado === "rechazados"
          ? `AND v.estado_validacion = 'rechazado_manual'`
          : "";

  const hayBusqueda = Boolean(like || digitos || ultimos8);

  const sqlComprobantes = `
    SELECT v.id::text                                   AS validacion_id,
           v.created_at,
           v.estado_validacion,
           v.motivo_validacion,
           v.comprobante_url,
           v.ocr_monto,
           to_jsonb(v) ->> 'monto_validacion_ocr_gs'      AS monto_ocr_gs,
           to_jsonb(v) ->> 'monto_validacion_esperado_gs' AS monto_esperado_gs,
           v.ocr_referencia,
           v.ocr_banco,
           to_jsonb(v) ->> 'manual_approval_at'           AS manual_at,
           to_jsonb(v) ->> 'manual_approval_note'         AS manual_nota,
           v.conversation_id::text                        AS conversation_id,
           ct.name                                        AS contacto_nombre,
           ct.phone_number                                AS telefono,
           fd.nombre                                      AS fd_nombre,
           fd.documento                                   AS fd_documento,
           e.id::text                                     AS entrada_id,
           to_jsonb(e) ->> 'numero_orden'                 AS numero_orden,
           e.nombre_participante,
           e.documento,
           e.monto_total,
           e.estado_pago,
           e.cantidad_boletos,
           e.revendedor_id::text                          AS revendedor_id,
           s.nombre                                       AS sorteo_nombre,
           COALESCE((SELECT array_agg(c.numero_cupon ORDER BY c.numero_cupon)
                       FROM ${tCup} c WHERE c.entrada_id = e.id), '{}') AS boletas
      FROM ${tVal} v
      LEFT JOIN ${tConv} cv ON cv.id = v.conversation_id
      LEFT JOIN ${tCont} ct ON ct.id = cv.contact_id
      LEFT JOIN ${tEnt} e ON e.id = v.sorteo_entrada_id
      LEFT JOIN ${tSor} s ON s.id = e.sorteo_id
      LEFT JOIN LATERAL (
        SELECT max(f.field_value) FILTER (WHERE f.field_name ~* 'nombre' AND f.field_name !~* 'apellido')    AS nombre,
               max(f.field_value) FILTER (WHERE f.field_name ~* '(documento|cedula|^ci$|dni|ruc)')           AS documento
          FROM ${tFd} f
         WHERE f.flow_session_id = v.flow_session_id
      ) fd ON true
     WHERE v.empresa_id = $1::uuid
       AND ($5::timestamptz IS NULL OR v.created_at >= $5::timestamptz)
       AND ($6::timestamptz IS NULL OR v.created_at <  $6::timestamptz)
       ${filtroEstado}
       AND (
         NOT ${hayBusqueda}
         OR ($2::text IS NOT NULL AND (ct.name ILIKE $2 OR fd.nombre ILIKE $2 OR fd.documento ILIKE $2))
         OR ($3::text IS NOT NULL AND (
               regexp_replace(COALESCE(fd.documento, ''), '\\D', '', 'g') = $3
            OR v.ocr_referencia = $3))
         OR ($4::text IS NOT NULL AND ${tel("ct.phone_number")} = $4)
         OR (e.id IS NOT NULL AND ${coincideCompra("e")})
       )
     ORDER BY v.created_at DESC
     LIMIT $7
  `;

  /**
   * Compras sin comprobante (vendedor o ERP), solo al buscar a alguien: sin búsqueda serían
   * todas las ventas del mostrador, que ya están en Cupones. No entran al filtro «pendientes»,
   * que es de comprobantes.
   */
  const incluirCompras = hayBusqueda && (estado === "todos" || estado === "aprobados" || estado === "rechazados");
  const filtroEstadoCompra =
    estado === "rechazados" ? `AND e.estado_pago = 'rechazado'` : estado === "aprobados" ? `AND e.estado_pago <> 'rechazado'` : "";
  const sqlCompras = `
    SELECT e.id::text                     AS entrada_id,
           e.created_at,
           to_jsonb(e) ->> 'numero_orden' AS numero_orden,
           e.nombre_participante,
           e.documento,
           e.whatsapp_numero,
           e.monto_total,
           e.estado_pago,
           e.cantidad_boletos,
           e.revendedor_id::text          AS revendedor_id,
           e.chat_conversation_id::text   AS conversation_id,
           to_jsonb(e) ->> 'venta_origen' AS venta_origen,
           s.nombre                       AS sorteo_nombre,
           COALESCE((SELECT array_agg(c.numero_cupon ORDER BY c.numero_cupon)
                       FROM ${tCup} c WHERE c.entrada_id = e.id), '{}') AS boletas
      FROM ${tEnt} e
      LEFT JOIN ${tSor} s ON s.id = e.sorteo_id
     WHERE e.empresa_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM ${tVal} v WHERE v.sorteo_entrada_id = e.id)
       AND ($5::timestamptz IS NULL OR e.created_at >= $5::timestamptz)
       AND ($6::timestamptz IS NULL OR e.created_at <  $6::timestamptz)
       ${filtroEstadoCompra}
       AND ${coincideCompra("e")}
     ORDER BY e.created_at DESC
     LIMIT $7
  `;

  const [rc, re] = await Promise.all([
    pool.query(sqlComprobantes, params),
    incluirCompras ? pool.query(sqlCompras, params) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);

  const canalDe = (r: Record<string, unknown>): FilaComprobanteCompra["canal"] => {
    if (!r.entrada_id) return null;
    if (r.revendedor_id) return "vendedor";
    if (r.conversation_id && r.venta_origen !== "erp_manual") return "bot";
    return "manual";
  };

  const filasComp: FilaComprobanteCompra[] = (rc.rows as Record<string, unknown>[]).map((r) => ({
    tipo: "comprobante",
    id: String(r.validacion_id),
    fecha: new Date(String(r.created_at)).toISOString(),
    validacion_id: String(r.validacion_id),
    estado_validacion: txt(r.estado_validacion),
    motivo_validacion: txt(r.motivo_validacion),
    comprobante_url: txt(r.comprobante_url),
    monto_comprobante: num(r.monto_ocr_gs) ?? num(String(r.ocr_monto ?? "").replace(/\D/g, "")),
    monto_esperado: num(r.monto_esperado_gs),
    referencia: txt(r.ocr_referencia),
    banco: txt(r.ocr_banco),
    aprobacion_manual_at: txt(r.manual_at),
    aprobacion_manual_nota: txt(r.manual_nota),
    conversation_id: txt(r.conversation_id),
    contacto_nombre: txt(r.contacto_nombre),
    telefono: txt(r.telefono),
    nombre: txt(r.nombre_participante) ?? txt(r.fd_nombre) ?? txt(r.contacto_nombre),
    documento: txt(r.documento) ?? txt(r.fd_documento),
    entrada_id: txt(r.entrada_id),
    numero_orden: txt(r.numero_orden),
    sorteo_nombre: txt(r.sorteo_nombre),
    monto_compra: num(r.monto_total),
    estado_pago: txt(r.estado_pago),
    cantidad_boletos: num(r.cantidad_boletos),
    boletas: Array.isArray(r.boletas) ? (r.boletas as unknown[]).map(String) : [],
    canal: r.entrada_id ? (r.revendedor_id ? "vendedor" : "bot") : null,
  }));

  const filasCompra: FilaComprobanteCompra[] = (re.rows as Record<string, unknown>[]).map((r) => ({
    tipo: "compra_sin_comprobante",
    id: String(r.entrada_id),
    fecha: new Date(String(r.created_at)).toISOString(),
    validacion_id: null,
    estado_validacion: null,
    motivo_validacion: null,
    comprobante_url: null,
    monto_comprobante: null,
    monto_esperado: null,
    referencia: null,
    banco: null,
    aprobacion_manual_at: null,
    aprobacion_manual_nota: null,
    conversation_id: txt(r.conversation_id),
    contacto_nombre: null,
    telefono: txt(r.whatsapp_numero),
    nombre: txt(r.nombre_participante),
    documento: txt(r.documento),
    entrada_id: txt(r.entrada_id),
    numero_orden: txt(r.numero_orden),
    sorteo_nombre: txt(r.sorteo_nombre),
    monto_compra: num(r.monto_total),
    estado_pago: txt(r.estado_pago),
    cantidad_boletos: num(r.cantidad_boletos),
    boletas: Array.isArray(r.boletas) ? (r.boletas as unknown[]).map(String) : [],
    canal: canalDe(r),
  }));

  const truncado = filasComp.length > limite || filasCompra.length > limite;
  const filas = [...filasComp.slice(0, limite), ...filasCompra.slice(0, limite)]
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
    .slice(0, limite);

  const resumen: ResumenBusqueda = { comprobantes: 0, pendientes: 0, compras: 0, boletas: 0, monto_compras: 0 };
  for (const f of filas) {
    if (f.tipo === "comprobante") {
      resumen.comprobantes++;
      if (esComprobantePendiente(f)) resumen.pendientes++;
    }
    if (f.entrada_id && f.estado_pago !== "rechazado") {
      resumen.compras++;
      resumen.boletas += f.boletas.length;
      resumen.monto_compras += f.monto_compra ?? 0;
    }
  }

  return { filas, resumen, truncado };
}
