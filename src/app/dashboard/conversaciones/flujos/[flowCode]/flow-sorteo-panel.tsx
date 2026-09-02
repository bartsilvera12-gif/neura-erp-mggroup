"use client";

/** Sección opcional del editor: vincula el flujo con el módulo Sorteos. No afecta la edición de pasos. */
export function FlowSorteoPanel({
  sorteosOptions,
  flowSorteoId,
  flowSorteoNombre,
  sorteoDraft,
  onChangeSorteoDraft,
  savingSorteoLink,
  onSaveSorteoLink,
  incompleteMsgDraft,
  onChangeIncompleteMsg,
  savingIncompleteMsg,
  onSaveIncompleteMsg,
}: {
  sorteosOptions: { id: string; nombre: string }[];
  flowSorteoId: string | null;
  flowSorteoNombre: string | null;
  sorteoDraft: string;
  onChangeSorteoDraft: (value: string) => void;
  savingSorteoLink: boolean;
  onSaveSorteoLink: () => void;
  incompleteMsgDraft: string;
  onChangeIncompleteMsg: (value: string) => void;
  savingIncompleteMsg: boolean;
  onSaveIncompleteMsg: () => void;
}) {
  return (
    <details className="bg-white border border-slate-200 rounded-xl shadow-sm group">
      <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-slate-800 hover:bg-slate-50/80 rounded-xl [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-400 group-open:rotate-90 transition-transform">▸</span>
          Integración con sorteos
          <span className="font-normal text-slate-500">(opcional)</span>
        </span>
        {flowSorteoId ? (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 max-w-[min(100%,16rem)] truncate">
            {flowSorteoNombre || "Vinculado"}
          </span>
        ) : (
          <span className="text-xs text-slate-500">Sin vincular</span>
        )}
      </summary>
      <div className="px-4 pb-4 pt-0 space-y-3 border-t border-slate-100">
        <p className="text-xs text-slate-500 pt-3">
          Solo si usás el módulo Sorteos: al asociar un sorteo, al recibir el comprobante por WhatsApp se puede
          generar la orden y los cupones. No afecta la edición de pasos de arriba.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-slate-500 mb-1" htmlFor="sorteo-vinculado">
              Sorteo vinculado al flujo
            </label>
            <select
              id="sorteo-vinculado"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={sorteoDraft}
              onChange={(e) => onChangeSorteoDraft(e.target.value)}
            >
              <option value="">Ninguno</option>
              {sorteosOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={savingSorteoLink}
            onClick={onSaveSorteoLink}
            className="bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {savingSorteoLink ? "Guardando…" : "Guardar vínculo"}
          </button>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-slate-500" htmlFor="sorteo-incompleto-msg">
            Mensaje si faltan datos para registrar la compra del sorteo (WhatsApp). Vacío = texto por defecto del
            sistema.
          </label>
          <textarea
            id="sorteo-incompleto-msg"
            className="w-full min-h-[88px] rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={incompleteMsgDraft}
            onChange={(e) => onChangeIncompleteMsg(e.target.value)}
            placeholder="Ej.: No pudimos registrar esta compra. Tocá de nuevo tu opción y enviá el comprobante."
            maxLength={4000}
          />
          <button
            type="button"
            className="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={savingIncompleteMsg}
            onClick={onSaveIncompleteMsg}
          >
            {savingIncompleteMsg ? "Guardando…" : "Guardar mensaje"}
          </button>
        </div>
        {sorteosOptions.length === 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
            No hay sorteos en la empresa. Creá uno en el módulo Sorteos para poder asociarlo.
          </p>
        )}
      </div>
    </details>
  );
}
