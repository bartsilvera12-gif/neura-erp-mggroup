import { parseMoneyPy } from "@/lib/sorteos/parse-money-py";
import {
  buttonQuickReplyGroupsEnabled,
  partitionQuickReplyButtonGroups,
  validateQuickReplyGroupsMaxThree,
} from "@/lib/chat/flow-button-groups";
import type {
  FlowNode,
  FlowNodeBlock,
  FlowNodeOption,
  OptionSimpleDraft,
} from "./flow-editor-types";

export const NODE_TYPE_OPTIONS = [
  {
    value: "text",
    label: "Texto (automático o captura)",
    help: "Si tiene 'Guardar respuesta como' espera texto del cliente; si no, envía mensaje automático.",
  },
  {
    value: "media",
    label: "Mensaje con imagen",
    help: "Envía una sola burbuja con imagen y texto opcional (caption).",
  },
  { value: "buttons", label: "Botones", help: "Muestra botones rápidos al cliente." },
  { value: "list", label: "Lista", help: "Interacción tipo lista (catálogo de opciones)." },
  {
    value: "image_input",
    label: "Solicitar imagen (comprobante)",
    help: "Pide el comprobante por mensaje, espera una imagen, guarda la URL en «Guardar respuesta como» (ej. comprobante_pago) y avanza al siguiente paso.",
  },
  { value: "human", label: "Derivar a humano", help: "Pasa la conversación a atención humana." },
  { value: "end", label: "Finalizar", help: "Cierra la automatización del flujo." },
] as const;

/** Insertar en medio del grafo: sin tipo media (requiere bloques; crear desde el formulario general). */
export const INSERT_NODE_TYPE_OPTIONS = NODE_TYPE_OPTIONS.filter((o) => o.value !== "media");

export const MAX_WHATSAPP_IMAGE_CAPTION = 1024;

export const CONTEXT_VAR_KEYS = [
  "opcion_label",
  "cantidad",
  "producto",
  "monto",
  "promo_nombre",
  "precio_fuente",
  "precio_regular",
] as const;

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Evita que una respuesta parcial del PATCH borre campos con `undefined` al hacer spread sobre la opción local. */
export function mergeSavedFlowOption(
  prev: FlowNodeOption,
  incoming: Partial<FlowNodeOption>
): FlowNodeOption {
  return {
    ...prev,
    label: typeof incoming.label === "string" ? incoming.label : prev.label,
    option_value: typeof incoming.option_value === "string" ? incoming.option_value : prev.option_value,
    meta_button_id: typeof incoming.meta_button_id === "string" ? incoming.meta_button_id : prev.meta_button_id,
    next_node_code:
      incoming.next_node_code !== undefined ? incoming.next_node_code : prev.next_node_code,
    sort_order: typeof incoming.sort_order === "number" ? incoming.sort_order : prev.sort_order,
    group_title: incoming.group_title !== undefined ? incoming.group_title : prev.group_title,
    group_order:
      typeof incoming.group_order === "number" ? incoming.group_order : prev.group_order ?? 0,
    option_payload:
      incoming.option_payload !== undefined && incoming.option_payload !== null
        ? incoming.option_payload
        : prev.option_payload,
    node_id: typeof incoming.node_id === "string" ? incoming.node_id : prev.node_id,
    id: typeof incoming.id === "string" ? incoming.id : prev.id,
  };
}

/**
 * Orden estable para el editor: solo sort_order y uuid. No ordenar por group_title ni group_order aquí:
 * si no, al editar el título del grupo las filas se reordenan y el foco salta / los valores parecen “mezclarse”.
 */
export function sortOptionsStableForEditor(node: FlowNode): FlowNodeOption[] {
  return [...node.options].sort((a, b) => {
    const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Bloques tal como se muestran y se reordenan: ordenados por sort_order, y en nodos `media`
 * solo los de imagen. Los botones ↑/↓ deben indexar sobre esta lista y no sobre `node.blocks`.
 */
export function visibleBlocksForEditor(node: FlowNode): FlowNodeBlock[] {
  const list = node.node_type === "media" ? node.blocks.filter((b) => b.block_type === "image") : node.blocks;
  return [...list].sort((a, b) => {
    const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
}

export function validateButtonsQuickReplyGroups(node: FlowNode): string | null {
  if (node.node_type !== "buttons") return null;
  const opts = node.options.map((o) => ({
    id: o.id,
    label: o.label,
    option_value: o.option_value,
    meta_button_id: o.meta_button_id,
    next_node_code: o.next_node_code,
    sort_order: o.sort_order,
    group_title: o.group_title ?? null,
    group_order: o.group_order ?? 0,
  }));
  if (!buttonQuickReplyGroupsEnabled(opts)) return null;
  const defaultTitle = node.message_text?.trim() || "Opciones";
  const groups = partitionQuickReplyButtonGroups(opts, defaultTitle);
  return validateQuickReplyGroupsMaxThree(groups);
}

export function buttonGroupsEnabledForNode(node: FlowNode): boolean {
  if (node.node_type !== "buttons") return false;
  return buttonQuickReplyGroupsEnabled(
    node.options.map((o) => ({
      id: o.id,
      label: o.label,
      option_value: o.option_value,
      meta_button_id: o.meta_button_id,
      next_node_code: o.next_node_code,
      sort_order: o.sort_order,
      group_title: o.group_title ?? null,
      group_order: o.group_order ?? 0,
    }))
  );
}

export function compareFlowNodes(a: FlowNode, b: FlowNode): number {
  const bySort = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (bySort !== 0) return bySort;
  const byCreatedAt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (!Number.isNaN(byCreatedAt) && byCreatedAt !== 0) return byCreatedAt;
  return a.node_code.localeCompare(b.node_code);
}

export function prettifyCode(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function friendlyNodeTitle(node: FlowNode): string {
  if (node.node_type === "media") {
    const mediaCaption = node.blocks.find((b) => b.block_type === "image")?.content_text?.trim();
    if (mediaCaption) return `Mensaje con imagen: ${mediaCaption.slice(0, 24)}${mediaCaption.length > 24 ? "..." : ""}`;
    return "Mensaje con imagen";
  }
  const txt = node.message_text?.trim();
  if (txt) return txt.slice(0, 42) + (txt.length > 42 ? "..." : "");
  return prettifyCode(node.node_code);
}

/**
 * Etiqueta de `<select>` de destino. El título amigable sale del mensaje y puede repetirse
 * entre pasos distintos, así que siempre lleva el código interno al lado.
 */
export function nodePickerLabel(node: FlowNode): string {
  return `${friendlyNodeTitle(node)} · ${node.node_code}`;
}

export function nodeTypeLabel(nodeType: string): string {
  return NODE_TYPE_OPTIONS.find((n) => n.value === nodeType)?.label ?? nodeType;
}

export function nodeTypeHelp(nodeType: string): string {
  return (
    NODE_TYPE_OPTIONS.find((n) => n.value === nodeType)?.help ??
    "Configurá este paso según la experiencia del cliente."
  );
}

export function nodeAccent(nodeType: string): string {
  if (nodeType === "media") return "border-l-fuchsia-400";
  if (nodeType === "buttons" || nodeType === "list") return "border-l-sky-400";
  if (nodeType === "human") return "border-l-amber-400";
  if (nodeType === "end") return "border-l-emerald-400";
  if (nodeType === "image_input") return "border-l-violet-400";
  return "border-l-slate-300";
}

/** Color del chip que identifica el tipo de paso en la cabecera de la tarjeta. */
export function nodeTypeBadgeClass(nodeType: string): string {
  if (nodeType === "media") return "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200";
  if (nodeType === "buttons" || nodeType === "list") return "bg-sky-50 text-sky-700 border-sky-200";
  if (nodeType === "human") return "bg-amber-50 text-amber-800 border-amber-200";
  if (nodeType === "end") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (nodeType === "image_input") return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function toMetaButtonId(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || `btn_${Date.now()}`
  );
}

/** Evita colisión UNIQUE (node_id, meta_button_id) al derivar el id desde el label. */
export function resolveUniqueMetaButtonId(
  node: FlowNode,
  currentOptionId: string,
  label: string
): string {
  let base = toMetaButtonId(label);
  if (!base) base = `opt_${currentOptionId.replace(/-/g, "").slice(0, 12)}`;
  const others = node.options.filter((o) => o.id !== currentOptionId);
  const used = new Set(others.map((o) => o.meta_button_id));
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `_${n}`;
    candidate = `${base}${suffix}`.slice(0, 50);
    n += 1;
  }
  return candidate;
}

export function stringifyOptionPayload(value: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export function toSimpleDraftFromPayload(option: FlowNodeOption): OptionSimpleDraft {
  const p = option.option_payload ?? {};
  const regRaw = p.precio_regular ?? p.precio_regular_referencia ?? p.precio_lista ?? "";
  return {
    cantidad: p.cantidad === undefined || p.cantidad === null ? "" : String(p.cantidad),
    producto: p.producto === undefined || p.producto === null ? "" : String(p.producto),
    monto: p.monto === undefined || p.monto === null ? "" : String(p.monto),
    promo_nombre:
      p.promo_nombre === undefined || p.promo_nombre === null ? "" : String(p.promo_nombre),
    precio_regular: regRaw === undefined || regRaw === null ? "" : String(regRaw),
    /** Solo datos persistidos en payload; no copiar `option.label` (evita fusionar con «Texto del botón»). */
    opcion_label:
      p.opcion_label === undefined || p.opcion_label === null ? "" : String(p.opcion_label),
  };
}

export function stripSorteoFinalizeKeys(p: Record<string, unknown>): Record<string, unknown> {
  const o = { ...p };
  delete o.confirmar_orden_sorteo;
  delete o.finalize_sorteo_order;
  delete o.cerrar_compra_sorteo;
  return o;
}

export function buildPayloadFromSimple(
  existingPayload: Record<string, unknown> | undefined,
  draft: OptionSimpleDraft
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(existingPayload ?? {}) };
  const cantidad = draft.cantidad.trim();
  const producto = draft.producto.trim();
  const monto = draft.monto.trim();
  const promoNombre = draft.promo_nombre.trim();
  const precioRegular = draft.precio_regular.trim();
  /** «Etiqueta seleccionada» únicamente; el texto visible va en `chat_flow_options.label`, no aquí. */
  const etiquetaInterna = draft.opcion_label.trim();

  if (cantidad) base.cantidad = Number.isFinite(Number(cantidad)) ? Number(cantidad) : cantidad;
  else delete base.cantidad;
  if (producto) base.producto = producto;
  else delete base.producto;
  const montoParsed = monto ? parseMoneyPy(monto) : null;
  if (montoParsed != null && montoParsed > 0) {
    const r = Math.round(montoParsed);
    base.monto = r;
    base.monto_compra = r;
    base.monto_promocional = r;
    base.sorteo_monto_opcion = r;
    base.precio_fuente = "promo";
  } else {
    delete base.monto;
    delete base.monto_compra;
    delete base.monto_promocional;
    delete base.sorteo_monto_opcion;
    delete base.precio_fuente;
  }
  if (promoNombre) base.promo_nombre = promoNombre;
  else delete base.promo_nombre;
  const regParsed = precioRegular ? parseMoneyPy(precioRegular) : null;
  if (regParsed != null && regParsed > 0) {
    base.precio_regular = Math.round(regParsed);
  } else {
    delete base.precio_regular;
    delete base.precio_regular_referencia;
    delete base.precio_lista;
  }
  if (etiquetaInterna) base.opcion_label = etiquetaInterna;
  else delete base.opcion_label;

  return base;
}

/**
 * Aplica la respuesta del GET sin pisar lo que el usuario está editando.
 *
 * Antes, cualquier acción con `reload()` (crear una opción, subir una imagen, insertar un paso)
 * hacía `setNodes(items)` y borraba en silencio las ediciones sin guardar de los demás pasos.
 * Para los pasos marcados como sucios conservamos los campos editables locales y tomamos del
 * servidor todo lo estructural (altas y bajas de opciones y bloques).
 */
export function mergeServerNodesPreservingDirty(
  serverNodes: FlowNode[],
  localNodes: FlowNode[],
  dirtyNodeIds: ReadonlySet<string>
): FlowNode[] {
  if (dirtyNodeIds.size === 0) return serverNodes;
  const localById = new Map(localNodes.map((n) => [n.id, n]));
  return serverNodes.map((serverNode) => {
    if (!dirtyNodeIds.has(serverNode.id)) return serverNode;
    const local = localById.get(serverNode.id);
    if (!local) return serverNode;
    const localBlockById = new Map(local.blocks.map((b) => [b.id, b]));
    const localOptionById = new Map(local.options.map((o) => [o.id, o]));
    return {
      ...serverNode,
      node_type: local.node_type,
      message_text: local.message_text,
      save_as_field: local.save_as_field,
      next_node_code: local.next_node_code,
      crm_action_type: local.crm_action_type,
      input_validation: local.input_validation,
      input_invalid_message: local.input_invalid_message,
      blocks: serverNode.blocks.map((b) => {
        const lb = localBlockById.get(b.id);
        return lb ? { ...b, content_text: lb.content_text, media_url: lb.media_url } : b;
      }),
      options: serverNode.options.map((o) => {
        const lo = localOptionById.get(o.id);
        return lo
          ? {
              ...o,
              label: lo.label,
              next_node_code: lo.next_node_code,
              sort_order: lo.sort_order,
              group_title: lo.group_title,
              group_order: lo.group_order,
            }
          : o;
      }),
    };
  });
}
