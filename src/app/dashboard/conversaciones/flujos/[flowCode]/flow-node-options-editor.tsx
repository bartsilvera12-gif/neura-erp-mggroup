"use client";

import {
  buttonGroupsEnabledForNode,
  sortOptionsStableForEditor,
  stringifyOptionPayload,
  toSimpleDraftFromPayload,
} from "./flow-editor-helpers";
import type {
  FlowNode,
  FlowNodeOption,
  FlowOptionCreateContext,
  NodePickerItem,
  OptionSimpleDraft,
} from "./flow-editor-types";

const SIMPLE_FIELDS: {
  key: keyof OptionSimpleDraft;
  label: string;
  placeholder: string;
  span?: boolean;
}[] = [
  { key: "cantidad", label: "Cantidad", placeholder: "1" },
  { key: "producto", label: "Producto", placeholder: "1 boleto" },
  { key: "monto", label: "Monto", placeholder: "20000" },
  { key: "opcion_label", label: "Etiqueta seleccionada", placeholder: "Ej: 1 boleta 10.000 Gs (interno)" },
  { key: "promo_nombre", label: "Nombre de la promo", placeholder: "3 entradas por 50 mil", span: true },
  { key: "precio_regular", label: "Precio lista (opcional)", placeholder: "60000", span: true },
];

/** Botones rápidos o filas de lista que ve el cliente, con su destino y sus datos de contexto. */
export function FlowNodeOptionsEditor({
  node,
  pickerItems,
  flowSorteoId,
  optionSaveError,
  optionEditorMode,
  optionSimpleDrafts,
  optionPayloadDrafts,
  optionFinalizeSorteo,
  nextStepLabel,
  onPatchOption,
  onSetSimpleDraft,
  onSetPayloadDraft,
  onToggleEditorMode,
  onToggleFinalizeSorteo,
  onSaveOption,
  onDeleteOption,
  onCreateOption,
  onInsertAfterOption,
  onChangeOptionNext,
}: {
  node: FlowNode;
  /** Destinos posibles, ya sin el paso actual. */
  pickerItems: NodePickerItem[];
  flowSorteoId: string | null;
  optionSaveError: Record<string, string>;
  optionEditorMode: Record<string, "simple" | "advanced">;
  optionSimpleDrafts: Record<string, OptionSimpleDraft>;
  optionPayloadDrafts: Record<string, string>;
  optionFinalizeSorteo: Record<string, boolean>;
  nextStepLabel: (nextNodeCode: string | null) => string;
  onPatchOption: (nodeId: string, optionId: string, patch: Partial<FlowNodeOption>) => void;
  onSetSimpleDraft: (option: FlowNodeOption, patch: Partial<OptionSimpleDraft>) => void;
  onSetPayloadDraft: (optionId: string, value: string) => void;
  onToggleEditorMode: (optionId: string) => void;
  onToggleFinalizeSorteo: (optionId: string, checked: boolean) => void;
  onSaveOption: (node: FlowNode, option: FlowNodeOption) => Promise<void>;
  onDeleteOption: (node: FlowNode, option: FlowNodeOption) => Promise<void>;
  onCreateOption: (node: FlowNode, ctx?: FlowOptionCreateContext) => Promise<void>;
  onInsertAfterOption: (node: FlowNode, option: FlowNodeOption) => void;
  onChangeOptionNext: (node: FlowNode, option: FlowNodeOption) => void;
}) {
  const isList = node.node_type === "list";
  const options = sortOptionsStableForEditor(node);
  const grouped = buttonGroupsEnabledForNode(node);

  return (
    <section className="border border-slate-200 rounded-lg p-3 space-y-3 bg-white">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          {isList ? "Opciones de lista" : "Botones del cliente"}
          <span className="ml-2 font-normal normal-case text-slate-400">
            {options.length} {options.length === 1 ? "opción" : "opciones"}
          </span>
        </h3>
      </div>

      {!isList && (
        <details className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <summary className="cursor-pointer font-medium text-slate-700">
            Cómo se envían estos botones por WhatsApp
          </summary>
          <div className="pt-2 space-y-1.5 leading-snug">
            <p>
              El texto que ve el cliente es <strong>«Texto del botón»</strong>. Se guarda con{" "}
              <strong>Guardar opción</strong> o con <strong>Guardar paso</strong>.
            </p>
            {grouped ? (
              <p>
                <strong>Modo agrupado:</strong> cada título de grupo se envía como una burbuja aparte, con hasta{" "}
                <strong>3 botones rápidos</strong> por grupo. No se usa lista interactiva en este modo.
              </p>
            ) : (
              <p>
                Sin agrupar: hasta <strong>3</strong> opciones van como botones rápidos en un solo mensaje; con{" "}
                <strong>4 o más</strong> el sistema puede enviar un <strong>mensaje de lista</strong> (hasta 10 filas).
              </p>
            )}
          </div>
        </details>
      )}

      {options.length === 0 && (
        <p className="text-xs text-slate-500">
          Este paso todavía no tiene {isList ? "opciones" : "botones"}. Agregá al menos uno para que el cliente pueda
          continuar.
        </p>
      )}

      {options.map((opt, optIdx) => {
        const prevOpt = optIdx > 0 ? options[optIdx - 1] : null;
        const gKey = JSON.stringify([opt.group_order ?? 0, (opt.group_title ?? "").trim()]);
        const prevGKey = prevOpt
          ? JSON.stringify([prevOpt.group_order ?? 0, (prevOpt.group_title ?? "").trim()])
          : "";
        const showGroupHeading = grouped && gKey !== prevGKey;
        const headingLabel = (opt.group_title ?? "").trim() || node.message_text?.trim() || "Opciones";
        const mode = optionEditorMode[opt.id] ?? "simple";
        const finalizeOn = Boolean(optionFinalizeSorteo[opt.id]);
        const simpleDraft = optionSimpleDrafts[opt.id] ?? toSimpleDraftFromPayload(opt);

        return (
          <div key={opt.id} className="space-y-2">
            {showGroupHeading && (
              <div className="text-xs font-semibold text-slate-700 pt-2 border-t border-slate-200">
                Grupo: {headingLabel}
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1" htmlFor={`opt-label-${opt.id}`}>
                    {isList ? "Texto de la opción" : "Texto del botón"}
                  </label>
                  <input
                    id={`opt-label-${opt.id}`}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full bg-white"
                    value={opt.label}
                    onChange={(e) => onPatchOption(node.id, opt.id, { label: e.target.value })}
                    placeholder={isList ? "Ej: Plan Premium" : "Ej: Comprar entrada"}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1" htmlFor={`opt-next-${opt.id}`}>
                    Al tocarlo va a
                  </label>
                  <select
                    id={`opt-next-${opt.id}`}
                    className={`border rounded-lg px-2 py-1.5 text-sm w-full bg-white ${
                      optionSaveError[opt.id] ? "border-amber-400 ring-1 ring-amber-300" : "border-slate-200"
                    }`}
                    value={opt.next_node_code ?? ""}
                    onChange={(e) => onPatchOption(node.id, opt.id, { next_node_code: e.target.value || null })}
                  >
                    <option value="">(sin siguiente)</option>
                    {pickerItems.map((item) => (
                      <option key={item.node_code} value={item.node_code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {optionSaveError[opt.id] && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-1">
                      {optionSaveError[opt.id]}
                    </p>
                  )}
                </div>
              </div>

              {!isList && (
                <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">
                    Orden y agrupación
                  </summary>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1" htmlFor={`opt-sort-${opt.id}`}>
                        Orden opción
                      </label>
                      <input
                        id={`opt-sort-${opt.id}`}
                        type="number"
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full"
                        value={opt.sort_order}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          onPatchOption(node.id, opt.id, { sort_order: Number.isFinite(v) ? v : 0 });
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1" htmlFor={`opt-group-${opt.id}`}>
                        Título del grupo
                      </label>
                      <input
                        id={`opt-group-${opt.id}`}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full"
                        value={opt.group_title ?? ""}
                        placeholder="Ej: Combos populares"
                        onChange={(e) => onPatchOption(node.id, opt.id, { group_title: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1" htmlFor={`opt-group-order-${opt.id}`}>
                        Orden del grupo
                      </label>
                      <input
                        id={`opt-group-order-${opt.id}`}
                        type="number"
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full"
                        value={opt.group_order ?? 0}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          onPatchOption(node.id, opt.id, { group_order: Number.isFinite(v) ? v : 0 });
                        }}
                      />
                    </div>
                  </div>
                </details>
              )}

              <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">
                  Datos que guarda esta opción (cantidad, monto, promo…)
                </summary>
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      className="text-xs text-[#0EA5E9] hover:underline"
                      onClick={() => onToggleEditorMode(opt.id)}
                    >
                      {mode === "simple" ? "Usar modo JSON avanzado" : "Usar modo simple"}
                    </button>
                  </div>

                  {flowSorteoId && (
                    <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={finalizeOn}
                        onChange={(e) => onToggleFinalizeSorteo(opt.id, e.target.checked)}
                      />
                      <span className="text-xs text-slate-700 leading-snug">
                        <span className="font-medium text-violet-900">Cerrar compra del sorteo</span>
                        <span className="block text-slate-600 mt-0.5">
                          Marcar en el botón final (después de comprobante y datos). No redefine la oferta: solo
                          dispara la orden y cupones. Equivale a{" "}
                          <code className="text-[10px] bg-white/80 px-1 rounded">confirmar_orden_sorteo</code> en el
                          payload.
                        </span>
                      </span>
                    </label>
                  )}

                  {mode === "simple" ? (
                    finalizeOn && flowSorteoId ? (
                      <p className="text-xs text-slate-600 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                        Modo cierre: no se guardan aquí cantidad ni monto; se usa solo la señal de confirmación. La
                        oferta ya quedó al elegir la opción de compra.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        {SIMPLE_FIELDS.map((field) => (
                          <div key={field.key} className={field.span ? "md:col-span-2" : undefined}>
                            <label
                              className="block text-[11px] text-slate-500 mb-1"
                              htmlFor={`opt-${field.key}-${opt.id}`}
                            >
                              {field.label}
                            </label>
                            <input
                              id={`opt-${field.key}-${opt.id}`}
                              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full"
                              value={simpleDraft[field.key] ?? ""}
                              placeholder={field.placeholder}
                              onChange={(e) => onSetSimpleDraft(opt, { [field.key]: e.target.value })}
                            />
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <textarea
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono w-full min-h-[82px]"
                      value={optionPayloadDrafts[opt.id] ?? stringifyOptionPayload(opt.option_payload)}
                      placeholder={
                        '{\n  "cantidad": 3,\n  "monto": 50000,\n  "promo_nombre": "3 entradas por 50 mil"\n}'
                      }
                      onChange={(e) => onSetPayloadDraft(opt.id, e.target.value)}
                    />
                  )}

                  <p className="text-[11px] text-slate-500">
                    Se guardan en contexto al elegir esta opción. Con monto numérico se marca{" "}
                    <code className="text-[10px]">precio_fuente=promo</code>. Placeholders:{" "}
                    {`{{cantidad}}, {{producto}}, {{monto}}, {{promo_nombre}}, {{precio_regular}}, {{precio_fuente}}, {{opcion_label}}`}
                    .
                  </p>
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
                <button
                  type="button"
                  onClick={() => void onSaveOption(node, opt)}
                  className="text-xs px-2.5 py-1.5 rounded-md bg-[#0EA5E9] text-white hover:bg-[#0284C7]"
                >
                  Guardar opción
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={() => onChangeOptionNext(node, opt)}
                >
                  Cambiar destino
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1.5 rounded-md border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                  onClick={() => onInsertAfterOption(node, opt)}
                >
                  Insertar paso después
                </button>
                {grouped && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    onClick={() => void onCreateOption(node, { kind: "in_group", anchorOptionId: opt.id })}
                  >
                    + En este grupo
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs px-2 py-1.5 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 ml-auto"
                  onClick={() => void onDeleteOption(node, opt)}
                >
                  Eliminar
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                {isList ? "Opción" : "Botón"} «{opt.label || "(sin texto)"}» → {nextStepLabel(opt.next_node_code)}
              </p>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-3 items-center pt-1">
        {isList || !grouped ? (
          <button
            type="button"
            onClick={() => void onCreateOption(node)}
            className="text-sm text-[#0EA5E9] hover:underline"
          >
            {isList ? "+ Agregar opción" : "+ Agregar botón"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void onCreateOption(node, { kind: "new_group" })}
              className="text-sm text-[#0EA5E9] hover:underline"
            >
              + Nuevo grupo
            </button>
            <button
              type="button"
              onClick={() => void onCreateOption(node, { kind: "ungrouped" })}
              className="text-sm text-slate-600 hover:underline"
            >
              + Botón sin grupo
            </button>
          </>
        )}
      </div>
    </section>
  );
}
