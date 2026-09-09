"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Anular una venta desde la lista.
 *
 * Vive aparte de la celda de Pago porque son cosas distintas: ahí se resuelve un pago que está
 * en revisión; acá se deshace una venta que ya está hecha, que es lo que pasa con un duplicado
 * o una carga equivocada.
 *
 * Pide el motivo antes de dejar anular. Estas anulaciones se miran cuando la caja no cuadra, y
 * una sin explicación no se distingue de un error.
 */
export default function SorteoCuponAnularCell({
  entradaId,
  numeroOrden,
  cliente,
  cupones,
  estadoPago,
}: {
  entradaId: string;
  numeroOrden: number;
  cliente: string;
  cupones: string[];
  estadoPago: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const yaAnulada = String(estadoPago ?? "").trim() === "rechazado";

  async function anular() {
    if (motivo.trim().length < 3) {
      setErr("Escribí el motivo.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/sorteos/cupones/${encodeURIComponent(entradaId)}/anular`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: motivo.trim() }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        setErr(json.error ?? `Error ${res.status}`);
        return;
      }
      setOpen(false);
      setMotivo("");
      router.refresh();
    } catch {
      setErr("Error de red al anular.");
    } finally {
      setBusy(false);
    }
  }

  if (yaAnulada) {
    return (
      <td className="px-5 py-3 text-sm">
        <span className="text-xs text-slate-400">Anulada</span>
      </td>
    );
  }

  return (
    <td className="px-5 py-3 text-sm">
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setOpen(true);
        }}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        Anular
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-800">Anular esta venta</h2>
            {/*
              Se muestra qué se está por anular: en una lista de cincuenta filas parecidas, el
              número de orden solo no alcanza para estar seguro de cuál se tocó.
            */}
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div>
                <span className="text-slate-500">Orden</span>{" "}
                <span className="font-mono font-semibold">{numeroOrden}</span> — {cliente}
              </div>
              <div className="mt-0.5">
                <span className="text-slate-500">Números</span>{" "}
                <span className="font-mono">{cupones.join(", ") || "—"}</span>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Deja de contar en los totales y en la rendición del vendedor, y sus números no se
              vuelven a imprimir. No se borra nada: queda registrada como anulada con el motivo.
            </p>
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              Si estos números ya se imprimieron y están en la urna, hay que sacarlos a mano.
            </p>

            <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="motivo-anular">
              Motivo
            </label>
            <input
              id="motivo-anular"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: cargada dos veces"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            />

            {err ? (
              <p className="mt-3 rounded border border-red-100 bg-red-50 px-2 py-1.5 text-sm text-red-700">
                {err}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={busy}
                onClick={() => void anular()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Anulando…" : "Anular venta"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </td>
  );
}
