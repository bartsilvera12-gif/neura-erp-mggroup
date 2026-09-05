import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

export type OperacionVendedor = {
  entrada_id: string;
  fecha: string | null;
  numero_orden: number | null;
  cliente: string;
  documento: string | null;
  telefono: string | null;
  cantidad: number;
  monto: number;
  pago_metodo: string | null;
  estado_pago: string | null;
  boletas: number;
  cupones: string[];
  /** Ya rendida en un cierre anterior: no vuelve a entrar en uno nuevo. */
  cerrada: boolean;
};

export type ResumenPeriodo = {
  ventas: number;
  boletas: number;
  monto: number;
  monto_efectivo: number;
};

export type DetallePeriodo = {
  /** Solo lo que todavía no se rindió: es lo que se llevaría un cierre ahora. */
  pendiente: ResumenPeriodo;
  /** Todo lo del período, esté cerrado o no; sirve para contrastar con lo ya rendido. */
  total: ResumenPeriodo;
  operaciones: OperacionVendedor[];
};

const VACIO: ResumenPeriodo = { ventas: 0, boletas: 0, monto: 0, monto_efectivo: 0 };

function acumular(ops: OperacionVendedor[], soloPendientes: boolean): ResumenPeriodo {
  const r = { ...VACIO };
  for (const o of ops) {
    if (soloPendientes && o.cerrada) continue;
    r.ventas += 1;
    r.boletas += o.boletas;
    r.monto += o.monto;
    if ((o.pago_metodo ?? "") === "efectivo") r.monto_efectivo += o.monto;
  }
  return r;
}

/**
 * Operaciones de un vendedor en un período.
 *
 * Se excluyen las rechazadas, igual que en el ranking y en los KPIs del panel, para que las
 * tres pantallas no muestren números distintos de la misma venta.
 */
export async function operacionesDelPeriodo(
  pool: Pool,
  schema: string,
  empresaId: string,
  revendedorId: string,
  desdeIso: string,
  hastaIso: string
): Promise<DetallePeriodo> {
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");

  const r = await pool.query(
    `SELECT e.id::text            AS entrada_id,
            e.created_at          AS fecha,
            e.numero_orden        AS numero_orden,
            e.nombre_participante AS cliente,
            e.documento           AS documento,
            e.whatsapp_numero     AS telefono,
            e.cantidad_boletos    AS cantidad,
            e.monto_total         AS monto,
            e.pago_metodo         AS pago_metodo,
            e.estado_pago         AS estado_pago,
            e.cierre_id           AS cierre_id,
            COALESCE(c.boletas, 0)::int AS boletas,
            COALESCE(c.cupones, ARRAY[]::text[]) AS cupones
       FROM ${tEnt} e
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS boletas,
                array_agg(cu.numero_cupon ORDER BY cu.numero_cupon) AS cupones
           FROM ${tCup} cu
          WHERE cu.entrada_id = e.id
       ) c ON true
      WHERE e.empresa_id = $1::uuid
        AND e.revendedor_id = $2::uuid
        AND e.estado_pago <> 'rechazado'
        AND e.created_at >= $3::timestamptz
        AND e.created_at <= $4::timestamptz
      ORDER BY e.created_at DESC`,
    [empresaId, revendedorId, desdeIso, hastaIso]
  );

  const operaciones: OperacionVendedor[] = (r.rows ?? []).map((row: Record<string, unknown>) => ({
    entrada_id: String(row.entrada_id ?? ""),
    fecha:
      row.fecha == null
        ? null
        : row.fecha instanceof Date
          ? row.fecha.toISOString()
          : String(row.fecha),
    numero_orden: row.numero_orden == null ? null : Number(row.numero_orden),
    cliente: String(row.cliente ?? "").trim(),
    documento: row.documento == null ? null : String(row.documento),
    telefono: row.telefono == null ? null : String(row.telefono),
    cantidad: Number(row.cantidad ?? 0),
    monto: Number(row.monto ?? 0),
    pago_metodo: row.pago_metodo == null ? null : String(row.pago_metodo),
    estado_pago: row.estado_pago == null ? null : String(row.estado_pago),
    boletas: Number(row.boletas ?? 0),
    cupones: Array.isArray(row.cupones) ? (row.cupones as unknown[]).map((x) => String(x)) : [],
    cerrada: row.cierre_id != null,
  }));

  return {
    pendiente: acumular(operaciones, true),
    total: acumular(operaciones, false),
    operaciones,
  };
}

export type CierreRealizado = {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  ventas: number;
  boletas: number;
  monto: number;
  monto_efectivo: number;
  cerrado_por_nombre: string | null;
  created_at: string;
};

export type ResultadoCierre =
  | { ok: true; cierre: CierreRealizado }
  | { ok: false; message: string };

/**
 * Realiza el cierre de caja de un vendedor en un período.
 *
 * Todo ocurre en UNA transacción, detrás de un lock por vendedor: se seleccionan las ventas
 * pendientes, se crea el cierre y se marcan las ventas con su id. Sin el lock, dos cierres
 * simultáneos del mismo vendedor leerían las mismas ventas y ambas quedarían contadas dos
 * veces — que es justamente lo que el cierre existe para evitar.
 *
 * Solo entran ventas con `cierre_id IS NULL`: repetir un cierre sobre un período ya rendido
 * no encuentra nada y devuelve error en vez de duplicar la rendición.
 */
export async function realizarCierre(
  pool: Pool,
  schema: string,
  input: {
    empresaId: string;
    revendedorId: string;
    desdeIso: string;
    hastaIso: string;
    usuarioId: string | null;
    usuarioNombre: string | null;
    observacion?: string | null;
  }
): Promise<ResultadoCierre> {
  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCup = quoteSchemaTable(schema, "sorteo_cupones");
  const tCie = quoteSchemaTable(schema, "sorteo_cierres_caja");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `cierre:${input.revendedorId}`,
    ]);

    const agg = await client.query<{
      ventas: string;
      boletas: string;
      monto: string;
      efectivo: string;
    }>(
      `SELECT COUNT(*)::bigint AS ventas,
              COALESCE(SUM(cu.boletas), 0)::bigint AS boletas,
              COALESCE(SUM(e.monto_total), 0)::numeric AS monto,
              COALESCE(SUM(e.monto_total) FILTER (WHERE e.pago_metodo = 'efectivo'), 0)::numeric
                AS efectivo
         FROM ${tEnt} e
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS boletas FROM ${tCup} c WHERE c.entrada_id = e.id
         ) cu ON true
        WHERE e.empresa_id = $1::uuid
          AND e.revendedor_id = $2::uuid
          AND e.estado_pago <> 'rechazado'
          AND e.cierre_id IS NULL
          AND e.created_at >= $3::timestamptz
          AND e.created_at <= $4::timestamptz`,
      [input.empresaId, input.revendedorId, input.desdeIso, input.hastaIso]
    );

    const fila = agg.rows[0];
    const ventas = Number(fila?.ventas ?? 0);
    if (ventas === 0) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        message: "No hay ventas sin rendir en ese período. Puede que ya se hayan cerrado.",
      };
    }

    const ins = await client.query(
      `INSERT INTO ${tCie}
         (empresa_id, revendedor_id, periodo_desde, periodo_hasta,
          ventas, boletas, monto, monto_efectivo,
          cerrado_por_usuario_id, cerrado_por_nombre, observacion)
       VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz,
               $5, $6, $7, $8, $9, $10, $11)
       RETURNING id::text AS id, periodo_desde, periodo_hasta, ventas, boletas,
                 monto, monto_efectivo, cerrado_por_nombre, created_at`,
      [
        input.empresaId,
        input.revendedorId,
        input.desdeIso,
        input.hastaIso,
        ventas,
        Number(fila?.boletas ?? 0),
        Number(fila?.monto ?? 0),
        Number(fila?.efectivo ?? 0),
        input.usuarioId,
        input.usuarioNombre,
        input.observacion?.trim() || null,
      ]
    );
    const cierreId = String((ins.rows[0] as Record<string, unknown>).id);

    /** Mismo filtro que el agregado: se marcan exactamente las ventas que se contaron. */
    await client.query(
      `UPDATE ${tEnt}
          SET cierre_id = $5::uuid
        WHERE empresa_id = $1::uuid
          AND revendedor_id = $2::uuid
          AND estado_pago <> 'rechazado'
          AND cierre_id IS NULL
          AND created_at >= $3::timestamptz
          AND created_at <= $4::timestamptz`,
      [input.empresaId, input.revendedorId, input.desdeIso, input.hastaIso, cierreId]
    );

    await client.query("COMMIT");

    const row = ins.rows[0] as Record<string, unknown>;
    const iso = (v: unknown) =>
      v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    return {
      ok: true,
      cierre: {
        id: cierreId,
        periodo_desde: iso(row.periodo_desde),
        periodo_hasta: iso(row.periodo_hasta),
        ventas: Number(row.ventas ?? 0),
        boletas: Number(row.boletas ?? 0),
        monto: Number(row.monto ?? 0),
        monto_efectivo: Number(row.monto_efectivo ?? 0),
        cerrado_por_nombre: row.cerrado_por_nombre == null ? null : String(row.cerrado_por_nombre),
        created_at: iso(row.created_at),
      },
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[cierre-caja]", e instanceof Error ? e.message : e);
    return { ok: false, message: "No se pudo realizar el cierre." };
  } finally {
    client.release();
  }
}

/** Cierres ya realizados de un vendedor, del más reciente al más viejo. */
export async function listarCierres(
  pool: Pool,
  schema: string,
  empresaId: string,
  revendedorId: string
): Promise<CierreRealizado[]> {
  const t = quoteSchemaTable(schema, "sorteo_cierres_caja");
  const r = await pool.query(
    `SELECT id::text AS id, periodo_desde, periodo_hasta, ventas, boletas,
            monto, monto_efectivo, cerrado_por_nombre, created_at
       FROM ${t}
      WHERE empresa_id = $1::uuid AND revendedor_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 100`,
    [empresaId, revendedorId]
  );
  const iso = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
  return (r.rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    periodo_desde: iso(row.periodo_desde),
    periodo_hasta: iso(row.periodo_hasta),
    ventas: Number(row.ventas ?? 0),
    boletas: Number(row.boletas ?? 0),
    monto: Number(row.monto ?? 0),
    monto_efectivo: Number(row.monto_efectivo ?? 0),
    cerrado_por_nombre: row.cerrado_por_nombre == null ? null : String(row.cerrado_por_nombre),
    created_at: iso(row.created_at),
  }));
}
