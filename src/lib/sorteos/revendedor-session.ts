import { cookies } from "next/headers";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { looksLikeRevendedorAccessToken } from "@/lib/sorteos/revendedor-access";

/**
 * Sesión del revendedor (POS por link mágico). La cookie httpOnly guarda el propio
 * `access_token`; se revalida contra la BD en cada request, por lo que revocar el
 * link surte efecto inmediato. Ligado a modo single_client (empresa/schema fijos).
 */

export const REVENDEDOR_COOKIE = "neura_rv";
export const REVENDEDOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

export type RevendedorPosContext = {
  revendedorId: string;
  empresaId: string;
  /** Sorteo que vende: el suyo si lo tiene asignado, o el activo de la empresa. */
  sorteoId: string;
  nombre: string;
  /** Correlativo por empresa; sale impreso en el ticket. Null en altas viejas sin migrar. */
  numeroVendedor: number | null;
  /** Tiene PIN configurado: el POS debe pedirlo antes de dejar vender. */
  exigePin: boolean;
  cupoBoletos: number | null;
  sorteo: { nombre: string; precioPorBoleto: number; estado: string };
};

function schemaAndPool(): { schema: string; pool: NonNullable<ReturnType<typeof getChatPostgresPool>> } | null {
  let schema: string | null = null;
  try {
    schema = getSingleClientSchemaOrNull();
  } catch {
    schema = null;
  }
  const pool = getChatPostgresPool();
  if (!schema || !pool) return null;
  return { schema, pool };
}

export async function resolveRevendedorByAccessToken(
  tokenRaw: string
): Promise<RevendedorPosContext | null> {
  const token = (tokenRaw || "").trim();
  if (!looksLikeRevendedorAccessToken(token)) return null;
  const sp = schemaAndPool();
  if (!sp) return null;
  const qtRev = quoteSchemaTable(sp.schema, "sorteo_revendedores");
  const qtSor = quoteSchemaTable(sp.schema, "sorteos");
  /**
   * `sorteo_id` es opcional desde que los vendedores son un módulo de la empresa: NULL
   * significa «vende el sorteo activo». Por eso el sorteo se resuelve con LATERAL en vez de
   * un JOIN directo — con JOIN, un vendedor de empresa no resolvía sesión y su link daba
   * inválido. Las filas viejas, atadas a un sorteo, siguen resolviendo ese mismo sorteo.
   */
  const r = await sp.pool.query(
    `SELECT rv.id, rv.empresa_id, rv.nombre, rv.cupo_boletos,
            rv.numero_vendedor, rv.pin_hash,
            s.id AS sorteo_id, s.nombre AS sorteo_nombre, s.precio_por_boleto, s.estado
       FROM ${qtRev} rv
       CROSS JOIN LATERAL (
         SELECT so.id, so.nombre, so.precio_por_boleto, so.estado
           FROM ${qtSor} so
          WHERE so.empresa_id = rv.empresa_id
            AND (
              (rv.sorteo_id IS NOT NULL AND so.id = rv.sorteo_id)
              OR (rv.sorteo_id IS NULL AND so.estado = 'activo')
            )
          ORDER BY so.created_at DESC
          LIMIT 1
       ) s
      WHERE rv.access_token = $1 AND rv.access_revoked_at IS NULL AND rv.activo = true
      LIMIT 1`,
    [token]
  );
  const row = r.rows?.[0] as
    | {
        id: string;
        empresa_id: string;
        sorteo_id: string;
        nombre: string | null;
        cupo_boletos: number | null;
        numero_vendedor: number | null;
        pin_hash: string | null;
        sorteo_nombre: string | null;
        precio_por_boleto: string | number | null;
        estado: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    revendedorId: String(row.id),
    empresaId: String(row.empresa_id),
    sorteoId: String(row.sorteo_id),
    nombre: String(row.nombre ?? ""),
    numeroVendedor: row.numero_vendedor == null ? null : Number(row.numero_vendedor),
    exigePin: Boolean((row.pin_hash ?? "").trim()),
    cupoBoletos: row.cupo_boletos == null ? null : Number(row.cupo_boletos),
    sorteo: {
      nombre: String(row.sorteo_nombre ?? ""),
      precioPorBoleto: Number(row.precio_por_boleto ?? 0) || 0,
      estado: String(row.estado ?? ""),
    },
  };
}

/** Lee la sesión del revendedor desde la cookie (revalida contra BD). */
export async function readRevendedorSession(): Promise<RevendedorPosContext | null> {
  const jar = await cookies();
  const token = jar.get(REVENDEDOR_COOKIE)?.value;
  if (!token) return null;
  return resolveRevendedorByAccessToken(token);
}

export type RevendedorSaldo = {
  boletosVendidos: number;
  cupoRestante: number | null;
  saldoARendir: number;
};

/**
 * Agregados del revendedor: boletos vendidos (para cupo) y saldo a rendir
 * (ventas efectivo atribuidas - rendiciones registradas).
 */
export async function getRevendedorSaldo(ctx: RevendedorPosContext): Promise<RevendedorSaldo> {
  const sp = schemaAndPool();
  if (!sp) return { boletosVendidos: 0, cupoRestante: ctx.cupoBoletos, saldoARendir: 0 };
  const qtEnt = quoteSchemaTable(sp.schema, "sorteo_entradas");
  const qtRen = quoteSchemaTable(sp.schema, "sorteo_revendedor_rendiciones");

  const vend = await sp.pool.query(
    `SELECT COALESCE(SUM(cantidad_boletos),0)::int AS boletos,
            COALESCE(SUM(monto_total) FILTER (WHERE pago_metodo = 'efectivo'),0)::numeric AS efectivo
       FROM ${qtEnt}
      WHERE revendedor_id = $1::uuid AND estado_pago <> 'cancelado'`,
    [ctx.revendedorId]
  );
  const rend = await sp.pool.query(
    `SELECT COALESCE(SUM(monto),0)::numeric AS rendido FROM ${qtRen} WHERE revendedor_id = $1::uuid`,
    [ctx.revendedorId]
  );
  const boletos = Number(vend.rows?.[0]?.boletos ?? 0) || 0;
  const efectivo = Number(vend.rows?.[0]?.efectivo ?? 0) || 0;
  const rendido = Number(rend.rows?.[0]?.rendido ?? 0) || 0;
  return {
    boletosVendidos: boletos,
    cupoRestante: ctx.cupoBoletos == null ? null : Math.max(0, ctx.cupoBoletos - boletos),
    saldoARendir: Math.max(0, efectivo - rendido),
  };
}
