"use client";

import { GripVertical, Trash2 } from "lucide-react";
import { FlowNodeBlocksEditor } from "./flow-node-blocks-editor";
import { FlowNodeOptionsEditor } from "./flow-node-options-editor";
import {
  CONTEXT_VAR_KEYS,
  MAX_WHATSAPP_IMAGE_CAPTION,
  NODE_TYPE_OPTIONS,
  isValidHttpUrl,
  nodeAccent,
  nodeTypeBadgeClass,
  nodeTypeHelp,
  nodeTypeLabel,
} from "./flow-editor-helpers";
import type {
  FlowNode,
  FlowNodeBlock,
  FlowNodeOption,
  FlowOptionCreateContext,
  NodePickerItem,
  OptionSimpleDraft,
} from "./flow-editor-types";

const RESUMEN_COMPRA_TEXT =
  "Resumen de tu compra:\n\n• Opción elegida: {{opcion_label}}\n• Cantidad: {{cantidad}}\n• Producto: {{producto}}\n• Total: {{monto}} Gs";

export type FlowNodeCardProps = {
  node: FlowNode;
  index: number;
  isExpanded: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  reorderBusy: boolean;
  togglingActive: boolean;
  incomingLabels: string[];
  hasSelectableContext: boolean;
  /** Destinos posibles, ya sin el paso actual. */
  pickerItems: NodePickerItem[];
  nextStepLabel: (nextNodeCode: string | null) => string;
  flowSorteoId: string | null;
  creatingBlockKey: string | null;
  blockBusyKey: (nodeId: string, blockType: FlowNodeBlock["block_type"]) => string;
  optionSaveError: Record<string, string>;
  optionEditorMode: Record<string, "simple" | "advanced">;
  optionSimpleDrafts: Record<string, OptionSimpleDraft>;
  optionPayloadDrafts: Record<string, string>;
  optionFinalizeSorteo: Record<string, boolean>;
  onToggleExpand: (node: FlowNode) => void;
  onToggleActive: (node: FlowNode, isActive: boolean) => void;
  onPatchNode: (nodeId: string, patch: Partial<FlowNode>) => void;
  onPatchBlock: (nodeId: string, blockId: string, patch: Partial<FlowNodeBlock>) => void;
  onSaveNode: (node: FlowNode) => void;
  onDiscardChanges: (node: FlowNode) => void;
  onDeleteNode: (node: FlowNode) => void;
  onDragStartNode: (nodeId: string) => void;
  onDropNode: (draggedId: string, targetId: string) => void;
  onCreateBlock: (node: FlowNode, blockType: FlowNodeBlock["block_type"]) => Promise<void>;
  onSaveBlock: (node: FlowNode, blockId: string) => Promise<void>;
  onMoveBlock: (node: FlowNode, blockId: string, direction: -1 | 1) => Promise<void>;
  onDeleteBlock: (node: FlowNode, blockId: string) => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
  onError: (message: string) => void;
  onInsertAfterNode: (node: FlowNode) => void;
  onChangeNodeNext: (node: FlowNode) => void;
  onInsertAfterOption: (node: FlowNode, option: FlowNodeOption) => void;
  onChangeOptionNext: (node: FlowNode, option: FlowNodeOption) => void;
  onPatchOption: (nodeId: string, optionId: string, patch: Partial<FlowNodeOption>) => void;
  onSetSimpleDraft: (option: FlowNodeOption, patch: Partial<OptionSimpleDraft>) => void;
  onSetPayloadDraft: (optionId: string, value: string) => void;
  onToggleEditorMode: (optionId: string) => void;
  onToggleFinalizeSorteo: (optionId: string, checked: boolean) => void;
  onSaveOption: (node: FlowNode, option: FlowNodeOption) => Promise<void>;
  onDeleteOption: (node: FlowNode, option: FlowNodeOption) => Promise<void>;
  onCreateOption: (node: FlowNode, ctx?: FlowOptionCreateContext) => Promise<void>;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{children}</h3>;
}

export function FlowNodeCard(props: FlowNodeCardProps) {
  const {
    node,
    index,
    isExpanded,
    isDirty,
    isSaving,
    isDeleting,
    reorderBusy,
    togglingActive,
    incomingLabels,
    hasSelectableContext,
    pickerItems,
    nextStepLabel,
  } = props;

  const imageBlock = node.blocks.find((b) => b.block_type === "image");
  const isOptionsNode = node.node_type === "buttons" || node.node_type === "list";
  const incomingText = incomingLabels.length ? incomingLabels.join(" · ") : "Paso inicial o sin referencias previas";

  return (
    <div
      className={`bg-white border border-slate-200 border-l-4 ${nodeAccent(
        node.node_type
      )} rounded-xl shadow-sm ${isDirty ? "ring-1 ring-amber-300" : ""}`}
      onDragOver={(e) => {
        if (reorderBusy) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (reorderBusy) return;
        e.preventDefault();
        const id =
          e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("application/x-neura-node-id");
        if (id) props.onDropNode(id, node.id);
      }}
    >
      {/*
        Cabecera de una sola línea: número, título, tipo y código. El detalle de conexiones va
        debajo en texto plano, sin recuadros: dos cajas grises por paso llenaban la pantalla.
      */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            draggable={!reorderBusy}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", node.id);
              e.dataTransfer.setData("application/x-neura-node-id", node.id);
              e.dataTransfer.effectAllowed = "move";
              props.onDragStartNode(node.id);
            }}
            className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500"
            title="Arrastrar para reordenar (solo orden en el editor; no cambia enlaces del flujo)"
            aria-label={`Arrastrar para reordenar el paso ${node.node_code}`}
          >
            <GripVertical className="w-4 h-4" aria-hidden />
          </button>
          <span className="text-xs font-semibold text-slate-400 shrink-0">#{index + 1}</span>
          <button
            type="button"
            onClick={() => props.onToggleExpand(node)}
            className="text-sm font-semibold text-slate-800 truncate text-left hover:text-[#0284C7] min-w-0"
            title={node.message_text?.trim() || node.node_code}
          >
            {node.message_text?.trim()?.slice(0, 60) || nodeTypeLabel(node.node_type)}
          </button>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${nodeTypeBadgeClass(node.node_type)}`}>
            {nodeTypeLabel(node.node_type)}
          </span>
          <code className="text-[11px] text-slate-400 font-mono truncate hidden sm:block">{node.node_code}</code>
          {isDirty && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
              Sin guardar
            </span>
          )}
          {!node.is_active && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
              Inactivo
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <label className="text-xs text-slate-600 flex items-center gap-1.5" title="Se guarda al instante">
            <input
              type="checkbox"
              checked={node.is_active}
              disabled={togglingActive}
              onChange={(e) => props.onToggleActive(node, e.target.checked)}
            />
            Activo
          </label>
          <button
            type="button"
            onClick={() => props.onToggleExpand(node)}
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            {isExpanded ? "Cerrar" : "Editar"}
          </button>
          <button
            type="button"
            onClick={() => props.onDeleteNode(node)}
            disabled={isDeleting || reorderBusy}
            className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
            title="Eliminar paso"
            aria-label={`Eliminar paso ${node.node_code}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conexiones en una línea: lo justo para leer el flujo sin abrir cada paso. */}
      <div className="px-3 pb-2.5 pl-9 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="truncate max-w-full">
          <span className="text-slate-400">va a</span>{" "}
          <span className="text-slate-700">
            {isOptionsNode ? "según el botón elegido" : nextStepLabel(node.next_node_code)}
          </span>
        </span>
        <span className="truncate max-w-full" title={incomingText}>
          <span className="text-slate-400">viene de</span>{" "}
          <span className="text-slate-700">
            {incomingLabels.length === 0
              ? "nadie (paso inicial)"
              : incomingLabels.length === 1
                ? incomingLabels[0]
                : `${incomingLabels[0]} +${incomingLabels.length - 1}`}
          </span>
        </span>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-5">
          {/* 1. Tipo de paso */}
          <section className="space-y-2">
            <SectionTitle>Tipo de paso</SectionTitle>
            <select
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full md:max-w-sm bg-white"
              value={node.node_type}
              aria-label="Tipo de nodo"
              onChange={(e) => props.onPatchNode(node.id, { node_type: e.target.value })}
            >
              {NODE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">{nodeTypeHelp(node.node_type)}</p>
          </section>

          {node.node_type === "image_input" && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2 text-xs text-violet-900 space-y-1">
              <div className="font-semibold">Solicitar imagen (comprobante)</div>
              <p>
                Usá el mensaje de abajo para pedir la imagen. En «Opciones avanzadas» completá{" "}
                <span className="font-medium">Guardar respuesta como</span> (recomendado:{" "}
                <code className="bg-violet-100 px-1 rounded">comprobante_pago</code>) y elegí el siguiente paso. El
                flujo avanza solo cuando llega una imagen válida.
              </p>
            </div>
          )}

          {/* 2. Contenido del mensaje */}
          <section className="space-y-3">
            <SectionTitle>Contenido del mensaje</SectionTitle>

            {node.node_type !== "media" ? (
              <div className="space-y-2">
                <label className="block text-xs text-slate-500" htmlFor={`node-msg-${node.id}`}>
                  Mensaje al cliente
                </label>
                <textarea
                  id={`node-msg-${node.id}`}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[74px] bg-white"
                  placeholder={
                    node.node_type === "image_input"
                      ? "Ej: Por favor envianos una foto o captura de tu comprobante de pago."
                      : "Se usa cuando el paso no tiene bloques configurados"
                  }
                  value={node.message_text ?? ""}
                  onChange={(e) => props.onPatchNode(node.id, { message_text: e.target.value })}
                />
                <p className="text-[11px] text-slate-500">
                  Podés usar placeholders del contexto, por ejemplo: {"{{producto}}"}, {"{{cantidad}}"},{" "}
                  {"{{monto}}"}.
                </p>
                {hasSelectableContext && (
                  <div className="border border-sky-100 bg-sky-50/60 rounded-lg p-2 space-y-2">
                    <div className="text-xs font-medium text-sky-800">Usar datos de la selección anterior</div>
                    <div className="flex flex-wrap gap-2">
                      {CONTEXT_VAR_KEYS.map((key) => (
                        <button
                          key={`${node.id}-${key}`}
                          type="button"
                          className="text-xs px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-100 bg-white"
                          onClick={() =>
                            props.onPatchNode(node.id, {
                              message_text: `${(node.message_text ?? "").trim()}\n{{${key}}}`.trim(),
                            })
                          }
                        >
                          Insertar {key}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-sky-300 text-sky-900 hover:bg-sky-100 font-medium bg-white"
                        onClick={() => props.onPatchNode(node.id, { message_text: RESUMEN_COMPRA_TEXT })}
                      >
                        Insertar resumen de compra
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-fuchsia-100 rounded-lg p-4 space-y-3 bg-white ring-1 ring-fuchsia-100/80">
                <div className="text-sm font-semibold text-fuchsia-800">Mensaje con imagen</div>
                <p className="text-xs text-slate-600">
                  WhatsApp envía una sola burbuja: imagen arriba y texto opcional debajo (caption).
                </p>
                {imageBlock ? (
                  <div className="space-y-2">
                    <label className="block text-xs text-slate-500" htmlFor={`media-file-${node.id}`}>
                      Imagen / URL de imagen
                    </label>
                    <input
                      id={`media-file-${node.id}`}
                      type="file"
                      accept="image/*"
                      className="text-xs"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const mediaUrl = await props.onUploadImage(file);
                          props.onPatchBlock(node.id, imageBlock.id, { media_url: mediaUrl });
                        } catch (err) {
                          props.onError(err instanceof Error ? err.message : "No se pudo subir imagen");
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                    <input
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      value={imageBlock.media_url ?? ""}
                      placeholder="https://..."
                      onChange={(e) => props.onPatchBlock(node.id, imageBlock.id, { media_url: e.target.value })}
                    />
                    {!!imageBlock.media_url && !isValidHttpUrl(imageBlock.media_url) && (
                      <div className="text-[11px] text-red-600">La URL debe iniciar con http:// o https://</div>
                    )}

                    <label className="block text-xs text-slate-500 mt-2" htmlFor={`media-caption-${node.id}`}>
                      Texto del mensaje (opcional)
                    </label>
                    <textarea
                      id={`media-caption-${node.id}`}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[70px]"
                      value={imageBlock.content_text ?? ""}
                      placeholder="Escribí un texto opcional para mostrar debajo de la imagen"
                      onChange={(e) => props.onPatchBlock(node.id, imageBlock.id, { content_text: e.target.value })}
                    />
                    {hasSelectableContext && (
                      <div className="flex flex-wrap gap-2">
                        {CONTEXT_VAR_KEYS.map((key) => (
                          <button
                            key={`${imageBlock.id}-${key}`}
                            type="button"
                            className="text-xs px-2 py-1 rounded border border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-100"
                            onClick={() =>
                              props.onPatchBlock(node.id, imageBlock.id, {
                                content_text: `${(imageBlock.content_text ?? "").trim()}\n{{${key}}}`.trim(),
                              })
                            }
                          >
                            Insertar {key}
                          </button>
                        ))}
                      </div>
                    )}
                    <div
                      className={`text-[11px] ${
                        (imageBlock.content_text ?? "").length > MAX_WHATSAPP_IMAGE_CAPTION
                          ? "text-red-600"
                          : "text-slate-500"
                      }`}
                    >
                      Texto: {(imageBlock.content_text ?? "").length}/{MAX_WHATSAPP_IMAGE_CAPTION}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={props.creatingBlockKey === props.blockBusyKey(node.id, "image")}
                    className="inline-flex items-center rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7] disabled:opacity-60 disabled:pointer-events-none"
                    onClick={() => void props.onCreateBlock(node, "image")}
                  >
                    {props.creatingBlockKey === props.blockBusyKey(node.id, "image")
                      ? "Preparando…"
                      : "Configurar imagen y texto"}
                  </button>
                )}
              </div>
            )}

            {/* Vista previa de lo que recibe el cliente. */}
            <div className="border border-slate-200 rounded-lg p-3 bg-white text-sm text-slate-700">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Vista previa
              </div>
              {node.node_type === "media" ? (
                imageBlock?.media_url && isValidHttpUrl(imageBlock.media_url) ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageBlock.media_url}
                      alt="Vista previa"
                      className="max-h-40 w-auto rounded-lg border border-slate-200 bg-white"
                    />
                    <p className="whitespace-pre-wrap">
                      {imageBlock.content_text?.trim() || "Sin texto bajo la imagen"}
                    </p>
                  </div>
                ) : (
                  <p className="text-slate-500 border border-dashed border-slate-200 rounded-lg px-3 py-3">
                    {imageBlock
                      ? "Pegá o subí una imagen con URL https válida para ver la previsualización."
                      : "Usá «Configurar imagen y texto» para armar la burbuja."}
                  </p>
                )
              ) : (
                <p className="whitespace-pre-wrap">
                  {node.blocks.find((b) => b.block_type === "text")?.content_text?.trim() ||
                    node.message_text?.trim() ||
                    "Sin texto de vista previa"}
                </p>
              )}
            </div>

            {node.node_type !== "media" && (
              <FlowNodeBlocksEditor
                node={node}
                creatingBlockKey={props.creatingBlockKey}
                blockBusyKey={props.blockBusyKey}
                onCreateBlock={props.onCreateBlock}
                onPatchBlock={props.onPatchBlock}
                onSaveBlock={props.onSaveBlock}
                onMoveBlock={props.onMoveBlock}
                onDeleteBlock={props.onDeleteBlock}
                onUploadImage={props.onUploadImage}
                onError={props.onError}
              />
            )}
          </section>

          {/* 3. Botones o filas de lista */}
          {isOptionsNode && (
            <FlowNodeOptionsEditor
              node={node}
              pickerItems={pickerItems}
              flowSorteoId={props.flowSorteoId}
              optionSaveError={props.optionSaveError}
              optionEditorMode={props.optionEditorMode}
              optionSimpleDrafts={props.optionSimpleDrafts}
              optionPayloadDrafts={props.optionPayloadDrafts}
              optionFinalizeSorteo={props.optionFinalizeSorteo}
              nextStepLabel={nextStepLabel}
              onPatchOption={props.onPatchOption}
              onSetSimpleDraft={props.onSetSimpleDraft}
              onSetPayloadDraft={props.onSetPayloadDraft}
              onToggleEditorMode={props.onToggleEditorMode}
              onToggleFinalizeSorteo={props.onToggleFinalizeSorteo}
              onSaveOption={props.onSaveOption}
              onDeleteOption={props.onDeleteOption}
              onCreateOption={props.onCreateOption}
              onInsertAfterOption={props.onInsertAfterOption}
              onChangeOptionNext={props.onChangeOptionNext}
            />
          )}

          {/* 4. Conexiones del paso */}
          <section className="space-y-2">
            <SectionTitle>Conexiones</SectionTitle>
            {isOptionsNode ? (
              <p className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                En pasos con botones o lista el destino se define en cada opción, arriba.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs text-slate-500 mb-1" htmlFor={`node-next-${node.id}`}>
                    Siguiente paso
                  </label>
                  <select
                    id={`node-next-${node.id}`}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white"
                    value={node.next_node_code ?? ""}
                    onChange={(e) => props.onPatchNode(node.id, { next_node_code: e.target.value || null })}
                  >
                    <option value="">(finaliza en este paso)</option>
                    {pickerItems.map((item) => (
                      <option key={item.node_code} value={item.node_code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="text-xs px-2.5 py-2 rounded-md border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                  title="Inserta un paso después del actual y antes de su siguiente destino"
                  onClick={() => props.onInsertAfterNode(node)}
                >
                  Insertar paso después
                </button>
                <button
                  type="button"
                  className="text-xs px-2.5 py-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={() => props.onChangeNodeNext(node)}
                >
                  Cambiar siguiente (guarda ya)
                </button>
              </div>
            )}
          </section>

          {/* 5. Avanzado */}
          <details className="border border-slate-200 rounded-lg p-3 bg-white">
            <summary className="text-sm font-medium text-slate-700 cursor-pointer">Opciones avanzadas</summary>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1" htmlFor={`node-save-as-${node.id}`}>
                  Guardar respuesta como
                </label>
                <input
                  id={`node-save-as-${node.id}`}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                  placeholder={
                    node.node_type === "image_input"
                      ? "ej: comprobante_pago (URL pública de la imagen)"
                      : "ej: nombre, cedula, ciudad"
                  }
                  value={node.save_as_field ?? ""}
                  onChange={(e) => props.onPatchNode(node.id, { save_as_field: e.target.value || null })}
                />
                {node.node_type === "image_input" && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Opcional pero recomendado: sin nombre de campo no se guarda en datos del flujo (el avance al
                    siguiente paso igual ocurre).
                  </p>
                )}
                {node.node_type === "text" && node.save_as_field?.trim() && (
                  <div className="mt-3 space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-2.5">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1" htmlFor={`node-input-val-${node.id}`}>
                        Qué tiene que responder el cliente
                      </label>
                      <select
                        id={`node-input-val-${node.id}`}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full bg-white"
                        value={node.input_validation === "number" ? "number" : "none"}
                        onChange={(e) => props.onPatchNode(node.id, { input_validation: e.target.value })}
                      >
                        <option value="none">Cualquier texto</option>
                        <option value="number">Solo un número (ej. cantidad de boletas)</option>
                      </select>
                    </div>
                    {node.input_validation === "number" && (
                      <div>
                        <label className="block text-xs text-slate-600 mb-1" htmlFor={`node-input-msg-${node.id}`}>
                          Mensaje si responde otra cosa
                        </label>
                        <input
                          id={`node-input-msg-${node.id}`}
                          className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full bg-white"
                          placeholder="Respondé únicamente el número, por favor. Ej: 2"
                          value={node.input_invalid_message ?? ""}
                          onChange={(e) =>
                            props.onPatchNode(node.id, { input_invalid_message: e.target.value || null })
                          }
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          El bot lo manda y se queda en este paso hasta recibir un número. Vacío = texto por
                          defecto.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-500 mb-1" htmlFor={`node-crm-${node.id}`}>
                  Acción en CRM (opcional)
                </label>
                <input
                  id={`node-crm-${node.id}`}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                  placeholder="ej: create_lead, move_funnel_stage, assign_advisor"
                  value={node.crm_action_type ?? ""}
                  onChange={(e) => props.onPatchNode(node.id, { crm_action_type: e.target.value || null })}
                />
              </div>
            </div>
          </details>

          {/* Barra de guardado: siempre al final del panel, después de todo lo editable. */}
          <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center gap-3 rounded-b-xl">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => props.onSaveNode(node)}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {isSaving ? "Guardando..." : "Guardar paso"}
            </button>
            {isDirty && (
              <>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => props.onDiscardChanges(node)}
                  className="px-3 py-2 rounded-lg text-sm border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Descartar cambios
                </button>
                <span className="text-xs text-amber-700">
                  Tenés cambios sin guardar en este paso.
                </span>
              </>
            )}
            {!isDirty && (
              <span className="text-xs text-slate-500">
                Guarda el mensaje, el tipo, el destino y los {isOptionsNode ? "botones" : "datos"} de este paso.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
