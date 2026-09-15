"use client";

import { useState } from "react";
import { MENSAJE_RECHAZO_POR_DEFECTO } from "@/lib/sorteos/comprobantes-compras-tipos";

const PYG = new Intl.NumberFormat("es-PY");

/**
 * Confirmación para rechazar un comprobante a mano: motivo obligatorio (queda registrado) y,
 * opcional, el mensaje que se le manda a la persona. Lo usan Sorteos → Comprobantes y el inbox.
 */
export function DialogoRechazarComprobante(props: {
  nombre: string | null;
  monto: number | null;
  /**
   * null: no generó compra. Si generó, el número de orden (o "" si no se sabe): esa compra
   * queda anulada.
   */
  numeroOrden: string | null;
  boletas: number;
  onCancelar: () => void;
  onConfirmar: (motivo: string, avisar: boolean, mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [mensaje, setMensaje] = useState(MENSAJE_RECHAZO_POR_DEFECTO);
  const valido = motivo.trim().length >= 3;
  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={props.onCancelar}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-slate-900">Rechazar comprobante</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          {props.nombre ?? "La persona"}
          {props.monto != null ? ` · Gs. ${PYG.format(Math.round(props.monto))}` : ""}.
          {props.numeroOrden === null
            ? " No generó boletas."
            : props.numeroOrden
              ? ` Este comprobante ya generó la orden N.º ${props.numeroOrden} con ${props.boletas} boleta(s): la orden queda anulada. Las boletas no se borran.`
              : " Este comprobante ya generó una compra: queda anulada. Las boletas no se borran."}
        </p>
        <label className="mt-4 block text-xs font-semibold text-slate-700">
          Motivo (queda registrado)
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: el pago no está en la cuenta"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-[#4FAEB2]"
            autoFocus
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          Avisarle por WhatsApp
        </label>
        {avisar ? (
          <>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#4FAEB2]"
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              WhatsApp solo deja escribirle si la persona mandó un mensaje en las últimas 24 horas.
            </p>
          </>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancelar}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valido}
            onClick={() => props.onConfirmar(motivo.trim(), avisar, mensaje)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}
