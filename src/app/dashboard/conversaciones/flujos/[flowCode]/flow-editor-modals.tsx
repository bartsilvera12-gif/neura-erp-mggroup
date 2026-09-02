"use client";

import { INSERT_NODE_TYPE_OPTIONS } from "./flow-editor-helpers";
import type { NodePickerItem } from "./flow-editor-types";

export type InsertModalState = {
  sourceType: "node" | "option";
  sourceNodeCode: string;
  sourceOptionId?: string;
  optionLabel?: string;
};

export type InsertDraft = {
  node_code: string;
  node_type: string;
  message_text: string;
  save_as_field: string;
};

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function InsertBetweenModal({
  state,
  draft,
  busy,
  onChangeDraft,
  onCancel,
  onSubmit,
}: {
  state: InsertModalState;
  draft: InsertDraft;
  busy: boolean;
  onChangeDraft: (patch: Partial<InsertDraft>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <ModalShell title="Insertar paso en el grafo" onClose={onCancel}>
      <p className="text-sm text-slate-600">
        Se creará un nuevo paso <strong>entre</strong>{" "}
        {state.sourceType === "option" ? (
          <>
            la opción «{state.optionLabel ?? "…"}» ({state.sourceNodeCode}) y su destino anterior
          </>
        ) : (
          <>«{state.sourceNodeCode}» y su siguiente paso anterior</>
        )}
        . La ejecución usa <code className="text-xs bg-slate-100 px-1 rounded">next_node_code</code>, no el orden
        visual.
      </p>
      <div className="space-y-2">
        <label className="block text-xs text-slate-500" htmlFor="insert-node-code">
          Código interno del nuevo paso
        </label>
        <input
          id="insert-node-code"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
          value={draft.node_code}
          onChange={(e) => onChangeDraft({ node_code: e.target.value })}
          placeholder="ej: confirmacion_extra"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-slate-500" htmlFor="insert-node-type">
          Tipo
        </label>
        <select
          id="insert-node-type"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={draft.node_type}
          onChange={(e) => onChangeDraft({ node_type: e.target.value })}
        >
          {INSERT_NODE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-slate-500" htmlFor="insert-message">
          Mensaje al cliente (opcional)
        </label>
        <textarea
          id="insert-message"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[72px]"
          value={draft.message_text}
          onChange={(e) => onChangeDraft({ message_text: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-slate-500" htmlFor="insert-save-as">
          Guardar respuesta como (opcional)
        </label>
        <input
          id="insert-save-as"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={draft.save_as_field}
          onChange={(e) => onChangeDraft({ save_as_field: e.target.value })}
          placeholder="ej: telefono_contacto"
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white hover:bg-[#0284C7] disabled:opacity-50"
          disabled={busy}
          onClick={onSubmit}
        >
          {busy ? "Insertando…" : "Insertar y enlazar"}
        </button>
      </div>
    </ModalShell>
  );
}

export function ChangeNextModal({
  kind,
  value,
  busy,
  /** Ya viene sin el paso de origen: elegirse a sí mismo crea un bucle infinito. */
  pickerItems,
  onChangeValue,
  onCancel,
  onSubmit,
}: {
  kind: "node" | "option";
  value: string;
  busy: boolean;
  pickerItems: NodePickerItem[];
  onChangeValue: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <ModalShell
      title={kind === "node" ? "Cambiar siguiente paso" : "Cambiar destino de la opción"}
      onClose={onCancel}
    >
      <p className="text-sm text-slate-600">Elegí el paso destino. Vacío = el flujo termina acá.</p>
      <select
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        aria-label="Paso destino"
      >
        <option value="">(sin siguiente)</option>
        {pickerItems.map((item) => (
          <option key={item.node_code} value={item.node_code}>
            {item.label}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white hover:bg-[#0284C7] disabled:opacity-50"
          disabled={busy}
          onClick={onSubmit}
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </ModalShell>
  );
}
