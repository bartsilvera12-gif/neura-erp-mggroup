import "server-only";

import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import {
  bucketForSaveField,
  flowDataHasValueForCaptureSaveField,
  type FlowCaptureGraphContext,
} from "@/lib/sorteos/sorteo-flow-capture-order";

/**
 * Datos del comprador que vuelve.
 *
 * El bot pedía nombre, cédula y ciudad en cada compra, aunque la persona escribiera desde el
 * mismo número y ya hubiera comprado diez veces: cada compra abre una sesión nueva del flujo y
 * el motor solo lee los datos de esa sesión. Acá se buscan los de su última compra y se dejan
 * cargados de entrada, así el flujo no vuelve a preguntar lo que ya sabe.
 */

/** Marca que la precarga ya corrió en esta sesión. No se borra: evita repetir la consulta. */
export const CAMPO_PRECARGA_ESTADO = "sorteo_datos_precarga";
/**
 * Campos precargados que todavía no se saltearon, separados por coma.
 *
 * Cada campo se saltea UNA sola vez y sale de esta lista. Es lo que hace que «corregir datos»
 * siga funcionando: al volver atrás, la lista ya no lo tiene y la pregunta se hace normalmente,
 * en vez de saltearse otra vez y dejar al cliente girando en el mismo lugar.
 */
export const CAMPO_PRECARGA_PENDIENTES = "sorteo_datos_precarga_pendientes";

export type DatosGuardadosComprador = {
  nombre: string;
  documento: string;
  ciudad: string;
};

/** Los últimos 8 dígitos: el mismo número se guarda como 0981… o como 59598l… según de dónde venga. */
function ultimosDigitos(telefono: string): string {
  const d = (telefono ?? "").replace(/\D/g, "");
  return d.length > 8 ? d.slice(-8) : d;
}

/**
 * Datos de la última compra hecha desde ese número de WhatsApp.
 *
 * La ciudad se busca en la venta, en lo que la persona contestó por WhatsApp y en su ficha de
 * cliente, en ese orden. `to_jsonb(e) ->> 'ciudad'` en vez de `e.ciudad` para que la consulta
 * siga funcionando aunque no se haya corrido la migración que agrega la columna.
 */
export async function leerDatosGuardadosPorTelefono(
  empresaId: string,
  telefono: string
): Promise<DatosGuardadosComprador | null> {
  const cola = ultimosDigitos(telefono);
  if (cola.length < 6) return null;

  const pool = getChatPostgresPool();
  const schema = getSingleClientSchemaOrNull();
  if (!pool || !schema) return null;

  const tEnt = quoteSchemaTable(schema, "sorteo_entradas");
  const tCli = quoteSchemaTable(schema, "clientes");
  const tFd = quoteSchemaTable(schema, "chat_flow_data");

  try {
    const r = await pool.query<{
      nombre: string | null;
      documento: string | null;
      ciudad: string | null;
    }>(
      `SELECT e.nombre_participante AS nombre,
              e.documento,
              COALESCE(
                NULLIF(TRIM(to_jsonb(e) ->> 'ciudad'), ''),
                (SELECT NULLIF(TRIM(fd.field_value), '')
                   FROM ${tFd} fd
                  WHERE fd.conversation_id = e.chat_conversation_id
                    AND fd.empresa_id = e.empresa_id
                    AND fd.field_name IN ('ciudad', 'localidad', 'ubicacion')
                    AND NULLIF(TRIM(fd.field_value), '') IS NOT NULL
                  ORDER BY fd.created_at DESC
                  LIMIT 1),
                NULLIF(TRIM(cl.ciudad), '')
              ) AS ciudad
         FROM ${tEnt} e
         LEFT JOIN ${tCli} cl ON cl.id = e.cliente_id AND cl.empresa_id = e.empresa_id
        WHERE e.empresa_id = $1::uuid
          AND right(regexp_replace(COALESCE(e.whatsapp_numero, ''), '\\D', '', 'g'), 8) = $2
          AND NULLIF(TRIM(COALESCE(e.nombre_participante, '')), '') IS NOT NULL
        ORDER BY e.created_at DESC
        LIMIT 1`,
      [empresaId, cola]
    );

    const row = r.rows[0];
    if (!row) return null;
    const datos: DatosGuardadosComprador = {
      nombre: (row.nombre ?? "").trim(),
      documento: (row.documento ?? "").trim(),
      ciudad: (row.ciudad ?? "").trim(),
    };
    return datos.nombre ? datos : null;
  } catch (e) {
    /** Sin datos previos el flujo pregunta todo, que es como venía funcionando. No se corta nada. */
    console.warn(
      "[sorteo-datos-guardados] consulta_fallida",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

export type PlanPrecarga = {
  /** Qué escribir en `chat_flow_data`, con las claves que usa este flujo. */
  valores: Record<string, string>;
  /** Los `save_as_field` que quedan listos para saltearse, en orden de flujo. */
  pendientes: string[];
};

/**
 * Traduce los datos guardados a las claves de captura de ESTE flujo.
 *
 * No asume nombres de campo: recorre los nodos de captura del flujo y usa el `save_as_field`
 * de cada uno. Un flujo puede guardar la cédula en `cedula`, otro en `documento`, y los dos
 * funcionan igual.
 *
 * Solo completa lo que falta: si la sesión ya tiene un valor —porque la persona lo escribió
 * recién— ese gana siempre.
 */
export function planificarPrecargaDeDatos(
  ctx: FlowCaptureGraphContext,
  flowData: Record<string, string>,
  datos: DatosGuardadosComprador
): PlanPrecarga {
  const valores: Record<string, string> = {};
  const pendientes: string[] = [];

  /** ¿El flujo separa nombre y apellido? Recién ahí tiene sentido partir el nombre completo. */
  let hayApellido = false;
  for (const code of ctx.order) {
    const n = ctx.nodesByCode.get(code);
    if (n && bucketForSaveField((n.save_as_field ?? "").trim()) === "apellido") hayApellido = true;
  }

  const partes = datos.nombre.split(/\s+/).filter(Boolean);
  const soloNombre = hayApellido && partes.length > 1 ? partes[0] : datos.nombre;
  const soloApellido = hayApellido && partes.length > 1 ? partes.slice(1).join(" ") : "";

  for (const code of ctx.order) {
    const nodo = ctx.nodesByCode.get(code);
    if (!nodo) continue;
    if ((nodo.node_type ?? "").trim().toLowerCase() !== "text") continue;
    const campo = (nodo.save_as_field ?? "").trim();
    if (!campo) continue;
    /** Lo que la sesión ya tiene manda: no se pisa una respuesta real con un dato viejo. */
    if (flowDataHasValueForCaptureSaveField(flowData, campo)) continue;

    let valor = "";
    switch (bucketForSaveField(campo)) {
      case "nombre":
        valor = soloNombre;
        break;
      case "apellido":
        valor = soloApellido;
        break;
      case "cedula":
        valor = datos.documento;
        break;
      case "ciudad":
        valor = datos.ciudad;
        break;
      default:
        valor = "";
    }
    if (!valor.trim()) continue;

    valores[campo] = valor.trim();
    pendientes.push(campo);
  }

  return { valores, pendientes };
}

/** Aviso al comprador de qué datos se están reusando, para que pueda corregirlos si cambiaron. */
export function textoDatosReutilizados(datos: DatosGuardadosComprador): string {
  const lineas = [`👤 ${datos.nombre}`];
  if (datos.documento) lineas.push(`🪪 ${datos.documento}`);
  if (datos.ciudad) lineas.push(`📍 ${datos.ciudad}`);
  return (
    "Ya tenemos tus datos de tu compra anterior:\n\n" +
    lineas.join("\n") +
    "\n\nSeguimos con eso. Si algo cambió, avisanos y lo corregimos."
  );
}

export function leerPendientes(flowData: Record<string, string>): string[] {
  return String(flowData[CAMPO_PRECARGA_PENDIENTES] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
