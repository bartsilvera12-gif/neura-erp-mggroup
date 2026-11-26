"use server";

import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";

export type CompraPendienteRow = {
  conversation_id: string;
  telefono: string;
  nombre: string;
  cedula: string;
  ciudad: string;
  opcion: string;
  ultimo_movimiento: string;
  estado_sesion: string;
};

/**
 * Contactos que cargaron sus datos (nombre y cédula) en el flujo de compra pero nunca llegaron a
 * generar boleta/orden: la sesión no tiene numero_orden ni sorteo_entrada_id, y la persona no
 * compró después en otra sesión de la misma conversación.
 */
export async function listarComprasPendientes(dias: number): Promise<CompraPendienteRow[]> {
  const { empresa_id } = await requireEmpresaTenantServiceRole();
  const pool = getChatPostgresPool();
  const schema = getSingleClientSchemaOrNull();
  if (!pool || !schema) return [];

  const d = Math.min(Math.max(Math.floor(Number(dias) || 7), 1), 90);
  const tS = quoteSchemaTable(schema, "chat_flow_sessions");
  const tD = quoteSchemaTable(schema, "chat_flow_data");
  const tC = quoteSchemaTable(schema, "chat_conversations");
  const tK = quoteSchemaTable(schema, "chat_contacts");

  const r = await pool.query<{
    conversation_id: string;
    telefono: string | null;
    nombre: string | null;
    cedula: string | null;
    ciudad: string | null;
    opcion: string | null;
    ultimo: string;
    estado: string;
  }>(
    `SELECT DISTINCT ON (s.conversation_id)
            s.conversation_id,
            k.phone_number AS telefono,
            (SELECT fd.field_value FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name = 'nombre' LIMIT 1) AS nombre,
            (SELECT fd.field_value FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name = 'cedula' LIMIT 1) AS cedula,
            (SELECT fd.field_value FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name = 'ciudad' LIMIT 1) AS ciudad,
            (SELECT fd.field_value FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name IN ('opcion_label','resumen_compra','cantidad') ORDER BY CASE fd.field_name WHEN 'opcion_label' THEN 0 WHEN 'resumen_compra' THEN 1 ELSE 2 END LIMIT 1) AS opcion,
            COALESCE(s.ended_at, c.last_message_at, s.created_at)::text AS ultimo,
            s.status AS estado
       FROM ${tS} s
       JOIN ${tC} c ON c.id = s.conversation_id AND c.empresa_id = s.empresa_id
       LEFT JOIN ${tK} k ON k.id = c.contact_id
      WHERE s.empresa_id = $1::uuid
        AND s.created_at > now() - ($2::int * interval '1 day')
        AND s.status <> 'completed'
        AND EXISTS (SELECT 1 FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name = 'cedula' AND NULLIF(TRIM(fd.field_value), '') IS NOT NULL)
        AND EXISTS (SELECT 1 FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name = 'nombre' AND NULLIF(TRIM(fd.field_value), '') IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM ${tD} fd WHERE fd.flow_session_id = s.id AND fd.field_name IN ('numero_orden','sorteo_entrada_id'))
        /* Si después compró en otra sesión de la misma conversación, ya no es una oportunidad pendiente. */
        AND NOT EXISTS (
          SELECT 1 FROM ${tD} fd2
           WHERE fd2.conversation_id = s.conversation_id
             AND fd2.field_name IN ('numero_orden','sorteo_entrada_id')
             AND fd2.created_at >= s.created_at
        )
      ORDER BY s.conversation_id, s.created_at DESC`,
    [empresa_id, d]
  );

  return r.rows
    .map((x) => ({
      conversation_id: x.conversation_id,
      telefono: x.telefono ?? "",
      nombre: x.nombre ?? "",
      cedula: x.cedula ?? "",
      ciudad: x.ciudad ?? "",
      opcion: x.opcion ?? "",
      ultimo_movimiento: x.ultimo,
      estado_sesion: x.estado,
    }))
    .sort((a, b) => b.ultimo_movimiento.localeCompare(a.ultimo_movimiento));
}
