/** Tipos compartidos por el editor de flujo y sus paneles. */

export type FlowNodeOption = {
  id: string;
  node_id: string;
  label: string;
  option_value: string;
  meta_button_id: string;
  next_node_code: string | null;
  sort_order: number;
  /** Título de burbuja WhatsApp (solo modo agrupado). */
  group_title?: string | null;
  group_order?: number;
  option_payload?: Record<string, unknown>;
};

export type OptionSimpleDraft = {
  cantidad: string;
  producto: string;
  monto: string;
  promo_nombre: string;
  precio_regular: string;
  opcion_label: string;
};

export type FlowNodeBlock = {
  id: string;
  node_id: string;
  block_type: "text" | "image" | "buttons";
  content_text: string | null;
  media_url: string | null;
  sort_order: number;
};

export type FlowNode = {
  id: string;
  node_code: string;
  node_type: string;
  message_text: string | null;
  save_as_field: string | null;
  next_node_code: string | null;
  sort_order: number;
  created_at: string;
  is_active: boolean;
  crm_action_type: string | null;
  crm_action_config: Record<string, unknown>;
  /** Captura de texto: qué se espera del cliente y qué repreguntar si no llega. */
  input_validation?: string | null;
  input_invalid_message?: string | null;
  /** Etiqueta del «✅ …» que confirma el dato capturado, pegado al mensaje siguiente. */
  capture_confirm_label?: string | null;
  /** Tope de la respuesta numérica; null = sin tope. */
  input_max_value?: number | null;
  options: FlowNodeOption[];
  blocks: FlowNodeBlock[];
};

export type FlowOptionCreateContext =
  | { kind: "default" }
  /** Nueva fila copiando grupo y destino típico del ancla (mismo group_title / group_order). */
  | { kind: "in_group"; anchorOptionId: string }
  /** Nuevo bloque de grupo vacío para completar en el editor. */
  | { kind: "new_group" }
  /** Opción sin group_title (bucket legacy) dentro de un nodo que también tiene grupos. */
  | { kind: "ungrouped" };

/** Opción de un `<select>` de destino: título legible + código interno para desambiguar. */
export type NodePickerItem = {
  node_code: string;
  label: string;
};
