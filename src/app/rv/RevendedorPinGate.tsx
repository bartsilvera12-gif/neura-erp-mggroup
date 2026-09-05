"use client";

import { useState } from "react";

/**
 * Pantalla de PIN del POS.
 *
 * Es solo la puerta visible: el PIN también se exige en el servidor, en la venta y en la
 * búsqueda de compradores. Saltear esta pantalla no habilita nada.
 */
export default function RevendedorPinGate({
  vendedorNombre,
  numeroVendedor,
  onDesbloqueado,
}: {
  vendedorNombre: string;
  numeroVendedor: number | null;
  onDesbloqueado: () => void;
}) {
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (pin.trim().length < 4) {
      setErr("El PIN tiene al menos 4 dígitos.");
      return;
    }
    setEnviando(true);
    setErr(null);
    try {
      const res = await fetch("/api/sorteos/revendedor-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || "No se pudo validar el PIN.");
      }
      onDesbloqueado();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "No se pudo validar el PIN.");
      setPin("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={enviar}
        className="w-full max-w-[360px] space-y-4 rounded-2xl bg-white p-6 shadow"
      >
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {numeroVendedor != null ? `Vendedor N.º ${numeroVendedor}` : "Vendedor"}
          </p>
          <h1 className="mt-1 text-lg font-bold text-slate-900">{vendedorNombre}</h1>
          <p className="mt-1 text-sm text-slate-500">Ingresá tu PIN para vender</p>
        </div>

        <input
          /* `password` para que no quede a la vista de quien esté al lado en el mostrador. */
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
          placeholder="••••"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-4 text-center text-2xl tracking-[0.4em] tabular-nums outline-none focus:border-[#4FAEB2]"
        />

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl bg-[#1e2a5a] py-3.5 text-base font-semibold text-white disabled:opacity-50"
        >
          {enviando ? "Verificando…" : "Entrar"}
        </button>

        <p className="text-center text-[11px] leading-relaxed text-slate-500">
          Si no lo recordás, pedile al administrador que te genere uno nuevo. Nadie puede
          consultarte el actual.
        </p>
      </form>
    </div>
  );
}
