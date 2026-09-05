import "server-only";

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { hashPin } from "@/lib/sorteos/vendedor-pin";

export type VendedorRow = {
  id: string;
  numero_vendedor: number | null;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  codigo_referido: string;
  activo: boolean;
  tiene_pin: boolean;
  tiene_link: boolean;
  cupo_boletos: number | null;
  sorteo_id: string | null;
  created_at: string | null;
};

function mapear(row: Record<string, unknown>): VendedorRow {
  return {
    id: String(row.id ?? ""),
    numero_vendedor: row.numero_vendedor == null ? null : Number(row.numero_vendedor),
    nombre: String(row.nombre ?? "").trim(),
    cargo: row.cargo == null ? null : String(row.cargo),
    telefono: row.telefono == null ? null : String(row.telefono),
    codigo_referido: String(row.codigo_referido ?? ""),
    activo: row.activo !== false,
    tiene_pin: Boolean(row.tiene_pin),
    tiene_link: Boolean(row.tiene_link),
    cupo_boletos: row.cupo_boletos == null ? null : Number(row.cupo_boletos),
    sorteo_id: row.sorteo_id == null ? null : String(row.sorteo_id),
    created_at: row.created_at == null ? null : String(row.created_at),
  };
}

/** Nunca expone `pin_hash` ni `access_token`: solo si existen. */
const COLUMNAS = `
  id::text AS id, numero_vendedor, nombre, cargo, telefono, codigo_referido, activo,
  (pin_hash IS NOT NULL AND pin_hash <> '') AS tiene_pin,
  (access_token IS NOT NULL AND access_revoked_at IS NULL) AS tiene_link,
  cupo_boletos, sorteo_id::text AS sorteo_id, created_at
`;

export async function listarVendedores(
  pool: Pool,
  schema: string,
  empresaId: string
): Promise<VendedorRow[]> {
  const t = quoteSchemaTable(schema, "sorteo_revendedores");
  const r = await pool.query(
    `SELECT ${COLUMNAS} FROM ${t}
      WHERE empresa_id = $1::uuid
      ORDER BY numero_vendedor NULLS LAST, created_at`,
    [empresaId]
  );
  return (r.rows ?? []).map(mapear);
}

export type AltaVendedor = {
  nombre: string;
  cargo?: string | null;
  telefono?: string | null;
  codigoReferido: string;
  activo?: boolean;
  cupoBoletos?: number | null;
  /** Ya validado por quien llama; acá solo se guarda su hash. */
  pin: string;
};

export type ResultadoAlta =
  | { ok: true; vendedor: VendedorRow }
  | { ok: false; message: string };

/**
 * Alta con número de vendedor correlativo por empresa.
 *
 * El número se calcula y se inserta dentro de la MISMA transacción, tomando antes un lock
 * por empresa. Sin eso, dos altas simultáneas leen el mismo máximo y sale dos veces el
 * «Vendedor 3»; el índice único evitaría el duplicado pero una de las dos altas fallaría
 * con un error incomprensible para quien la está cargando.
 *
 * El lock es por empresa, así que dos clientes distintos no se estorban.
 */
export async function crearVendedor(
  pool: Pool,
  schema: string,
  empresaId: string,
  input: AltaVendedor
): Promise<ResultadoAlta> {
  const t = quoteSchemaTable(schema, "sorteo_revendedores");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    /** Serializa las altas de esta empresa hasta el fin de la transacción. */
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`vendedores:${empresaId}`]);

    const codigo = input.codigoReferido.trim();
    const dup = await client.query(
      `SELECT 1 FROM ${t}
        WHERE empresa_id = $1::uuid
          AND lower(trim(codigo_referido)) = lower($2)
        LIMIT 1`,
      [empresaId, codigo]
    );
    if (dup.rows.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, message: "Ya existe un vendedor con ese código de referido." };
    }

    const max = await client.query<{ n: number | null }>(
      `SELECT MAX(numero_vendedor) AS n FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    const siguiente = Number(max.rows[0]?.n ?? 0) + 1;

    const ins = await client.query(
      `INSERT INTO ${t}
         (empresa_id, sorteo_id, nombre, cargo, telefono, codigo_referido, activo,
          cupo_boletos, numero_vendedor, pin_hash, pin_actualizado_at)
       VALUES ($1::uuid, NULL, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING ${COLUMNAS}`,
      [
        empresaId,
        input.nombre.trim(),
        input.cargo?.trim() || null,
        input.telefono?.trim() || null,
        codigo,
        input.activo !== false,
        input.cupoBoletos ?? null,
        siguiente,
        hashPin(input.pin),
      ]
    );

    await client.query("COMMIT");
    return { ok: true, vendedor: mapear(ins.rows[0] as Record<string, unknown>) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[vendedores][crear]", msg);
    return { ok: false, message: "No se pudo crear el vendedor." };
  } finally {
    client.release();
  }
}

export type CambioVendedor = {
  nombre?: string;
  cargo?: string | null;
  telefono?: string | null;
  activo?: boolean;
  cupoBoletos?: number | null;
  /** Si viene, reemplaza el PIN. El número de vendedor nunca se toca. */
  pin?: string;
};

/**
 * Edita un vendedor. `numero_vendedor` es deliberadamente inmutable: aparece en tickets ya
 * impresos y en cierres de caja, así que cambiarlo rompería la trazabilidad hacia atrás.
 */
export async function actualizarVendedor(
  pool: Pool,
  schema: string,
  empresaId: string,
  vendedorId: string,
  cambios: CambioVendedor
): Promise<ResultadoAlta> {
  const t = quoteSchemaTable(schema, "sorteo_revendedores");
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${i}`);
    vals.push(val);
    i += 1;
  };

  if (cambios.nombre !== undefined) push("nombre", cambios.nombre.trim());
  if (cambios.cargo !== undefined) push("cargo", cambios.cargo?.trim() || null);
  if (cambios.telefono !== undefined) push("telefono", cambios.telefono?.trim() || null);
  if (cambios.activo !== undefined) push("activo", cambios.activo);
  if (cambios.cupoBoletos !== undefined) push("cupo_boletos", cambios.cupoBoletos);
  if (cambios.pin !== undefined) {
    push("pin_hash", hashPin(cambios.pin));
    sets.push("pin_actualizado_at = now()");
  }

  if (sets.length === 0) {
    return { ok: false, message: "No hay cambios para guardar." };
  }

  vals.push(empresaId, vendedorId);
  try {
    const r = await pool.query(
      `UPDATE ${t} SET ${sets.join(", ")}
        WHERE empresa_id = $${i}::uuid AND id = $${i + 1}::uuid
        RETURNING ${COLUMNAS}`,
      vals
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, message: "Vendedor no encontrado." };
    return { ok: true, vendedor: mapear(row) };
  } catch (e) {
    console.error("[vendedores][actualizar]", e instanceof Error ? e.message : e);
    return { ok: false, message: "No se pudo guardar el vendedor." };
  }
}
