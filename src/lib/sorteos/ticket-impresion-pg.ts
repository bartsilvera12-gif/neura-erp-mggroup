import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import {
  CONFIG_TICKET_DEFECTO,
  type ConfigTicket,
  type DatosTicket,
} from "@/lib/sorteos/ticket-impresion-tipos";

function normalizar(row: Record<string, unknown> | undefined): ConfigTicket {
  if (!row) return { ...CONFIG_TICKET_DEFECTO };
  const ancho = Number(row.ancho_mm ?? 80);
  const copias = Math.trunc(Number(row.copias ?? 1));
  return {
    ancho_mm: ancho === 58 ? 58 : 80,
    negocio_nombre: String(row.negocio_nombre ?? "").trim(),
    logo_url: String(row.logo_url ?? "").trim(),
    encabezado: String(row.encabezado ?? "").trim(),
    pie: String(row.pie ?? "").trim(),
    mostrar_telefono: row.mostrar_telefono !== false,
    mostrar_vendedor: row.mostrar_vendedor !== false,
    /** Entre 1 y 3: más copias de un ticket térmico es papel tirado. */
    copias: Number.isFinite(copias) ? Math.min(3, Math.max(1, copias)) : 1,
  };
}

export async function leerConfigTicket(
  pool: Pool,
  schema: string,
  empresaId: string
): Promise<ConfigTicket> {
  const t = quoteSchemaTable(schema, "sorteo_ticket_impresion");
  try {
    const r = await pool.query(`SELECT * FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`, [
      empresaId,
    ]);
    return normalizar(r.rows[0] as Record<string, unknown> | undefined);
  } catch {
    /** Sin migrar todavía: se imprime con los valores por defecto en vez de fallar. */
    return { ...CONFIG_TICKET_DEFECTO };
  }
}

export async function guardarConfigTicket(
  pool: Pool,
  schema: string,
  empresaId: string,
  cfg: ConfigTicket
): Promise<ConfigTicket> {
  const t = quoteSchemaTable(schema, "sorteo_ticket_impresion");
  const r = await pool.query(
    `INSERT INTO ${t}
       (empresa_id, ancho_mm, negocio_nombre, logo_url, encabezado, pie,
        mostrar_telefono, mostrar_vendedor, copias, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (empresa_id) DO UPDATE SET
       ancho_mm = EXCLUDED.ancho_mm,
       negocio_nombre = EXCLUDED.negocio_nombre,
       logo_url = EXCLUDED.logo_url,
       encabezado = EXCLUDED.encabezado,
       pie = EXCLUDED.pie,
       mostrar_telefono = EXCLUDED.mostrar_telefono,
       mostrar_vendedor = EXCLUDED.mostrar_vendedor,
       copias = EXCLUDED.copias,
       updated_at = now()
     RETURNING *`,
    [
      empresaId,
      cfg.ancho_mm,
      cfg.negocio_nombre || null,
      cfg.logo_url || null,
      cfg.encabezado || null,
      cfg.pie || null,
      cfg.mostrar_telefono,
      cfg.mostrar_vendedor,
      cfg.copias,
    ]
  );
  return normalizar(r.rows[0] as Record<string, unknown>);
}


/**
 * Datos de una venta para imprimir su ticket.
 *
 * Se lee de la venta ya registrada, nunca de lo que mande el navegador: reimprimir tiene que
 * dar exactamente el mismo ticket, con el mismo número, sin poder alterar nada.
 */
export async function leerDatosTicket(
  pool: Pool,
  schema: string,
  empresaId: string,
  entradaId: string
): Promise<DatosTicket | null> {
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");
  const tSor = quoteSchemaTable(schema, "sorteos");
  const tRev = quoteSchemaTable(schema, "sorteo_revendedores");

  const r = await pool.query(
    `SELECT e.id::text AS entrada_id, e.numero_orden, e.created_at AS fecha,
            e.nombre_participante AS cliente, e.documento, e.whatsapp_numero AS telefono,
            e.cantidad_boletos AS cantidad, e.monto_total AS monto, e.pago_metodo,
            s.nombre AS sorteo_nombre,
            rv.nombre AS vendedor_nombre, rv.numero_vendedor AS vendedor_numero,
            COALESCE(c.cupones, ARRAY[]::text[]) AS cupones
       FROM ${tEnt} e
       LEFT JOIN ${tSor} s  ON s.id = e.sorteo_id
       LEFT JOIN ${tRev} rv ON rv.id = e.revendedor_id
       LEFT JOIN LATERAL (
         SELECT array_agg(cu.numero_cupon ORDER BY cu.numero_cupon) AS cupones
           FROM ${tCup} cu WHERE cu.entrada_id = e.id
       ) c ON true
      WHERE e.empresa_id = $1::uuid AND e.id = $2::uuid
      LIMIT 1`,
    [empresaId, entradaId]
  );

  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    entrada_id: String(row.entrada_id ?? ""),
    numero_orden: row.numero_orden == null ? null : Number(row.numero_orden),
    fecha:
      row.fecha == null
        ? null
        : row.fecha instanceof Date
          ? row.fecha.toISOString()
          : String(row.fecha),
    cliente: String(row.cliente ?? "").trim(),
    documento: row.documento == null ? null : String(row.documento),
    telefono: row.telefono == null ? null : String(row.telefono),
    cantidad: Number(row.cantidad ?? 0),
    monto: Number(row.monto ?? 0),
    pago_metodo: row.pago_metodo == null ? null : String(row.pago_metodo),
    cupones: Array.isArray(row.cupones) ? (row.cupones as unknown[]).map((x) => String(x)) : [],
    sorteo_nombre: String(row.sorteo_nombre ?? "").trim(),
    vendedor_nombre: row.vendedor_nombre == null ? null : String(row.vendedor_nombre),
    vendedor_numero: row.vendedor_numero == null ? null : Number(row.vendedor_numero),
  };
}

/** ¿La venta es de este vendedor? Para que un vendedor solo reimprima lo suyo. */
export async function entradaEsDelRevendedor(
  pool: Pool,
  schema: string,
  entradaId: string,
  revendedorId: string
): Promise<boolean> {
  const t = quoteSchemaTable(schema, "sorteo_entradas");
  const r = await pool.query(
    `SELECT 1 FROM ${t} WHERE id = $1::uuid AND revendedor_id = $2::uuid LIMIT 1`,
    [entradaId, revendedorId]
  );
  return r.rows.length > 0;
}
