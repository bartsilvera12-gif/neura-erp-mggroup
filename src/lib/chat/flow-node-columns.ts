/**
 * Columnas de `chat_flow_nodes` que se piden al leer un paso.
 *
 * El deploy del código y la migración de la base no son atómicos: si el código nuevo
 * pide una columna que todavía no existe, PostgREST devuelve error y se cae **toda** la
 * consulta. Eso deja el editor sin pasos y, peor, el bot sin poder leer el nodo actual.
 * Por eso hay una lista completa y una de respaldo sin las columnas nuevas.
 */

const BASE =
  "id, empresa_id, flow_code, node_code, message_text, save_as_field, next_node_code, node_type, is_active";

/** Agregadas por las migraciones de validación de captura y confirmación. */
const NUEVAS = "input_validation, input_invalid_message, capture_confirm_label, input_max_value";

export const FLOW_NODE_COLUMNS_FULL = `${BASE}, ${NUEVAS}`;
export const FLOW_NODE_COLUMNS_LEGACY = BASE;

export const FLOW_NODE_LIST_COLUMNS_FULL =
  "id, node_code, node_type, message_text, save_as_field, next_node_code, sort_order, is_active, crm_action_type, crm_action_config, input_validation, input_invalid_message, capture_confirm_label, input_max_value, created_at";
export const FLOW_NODE_LIST_COLUMNS_LEGACY =
  "id, node_code, node_type, message_text, save_as_field, next_node_code, sort_order, is_active, crm_action_type, crm_action_config, created_at";

/** ¿El error es «la columna no existe»? Sirve tanto para PostgREST como para el shim PG. */
export function isMissingColumnError(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("does not exist") && m.includes("column");
}

/**
 * Una vez detectado que la base todavía no tiene las columnas nuevas, se recuerda por
 * proceso para no pagar dos consultas en cada lectura.
 */
let faltanColumnasNuevas = false;

export function flowNodeColumns(list: boolean): string {
  if (list) return faltanColumnasNuevas ? FLOW_NODE_LIST_COLUMNS_LEGACY : FLOW_NODE_LIST_COLUMNS_FULL;
  return faltanColumnasNuevas ? FLOW_NODE_COLUMNS_LEGACY : FLOW_NODE_COLUMNS_FULL;
}

/** Devuelve true si conviene reintentar con la lista de respaldo. */
export function markMissingFlowNodeColumns(message: string | null | undefined): boolean {
  if (faltanColumnasNuevas || !isMissingColumnError(message)) return false;
  faltanColumnasNuevas = true;
  console.warn("[chat_flow_nodes]", "columnas_nuevas_ausentes_fallback", {
    message,
    hint: "Falta correr las migraciones de input_validation / capture_confirm_label.",
  });
  return true;
}
