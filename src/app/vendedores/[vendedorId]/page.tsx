"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Resumen = { ventas: number; boletas: number; monto: number; monto_efectivo: number };

type Operacion = {
  entrada_id: string;
  fecha: string | null;
  numero_orden: number | null;
  cliente: string;
  documento: string | null;
  cantidad: number;
  monto: number;
  pago_metodo: string | null;
  boletas: number;
  cerrada: boolean;
};

type Cierre = {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  ventas: number;
  boletas: number;
  monto: number;
  monto_efectivo: number;
  cerrado_por_nombre: string | null;
  created_at: string;
};

type Datos = {
  periodo: { desde: string; hasta: string };
  pendiente: Resumen;
  total: Resumen;
  operaciones: Operacion[];
  cierres: Cierre[];
};

const PYG = new Intl.NumberFormat("es-PY");
const num = (n: number) => PYG.format(Math.round(n || 0));
const gs = (n: number) => "₲ " + num(n);
const fecha = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
const soloFecha = (iso: string) => (!iso ? "—" : new Date(iso).toLocaleDateString("es-PY"));

function hoyYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function Kpi({ label, value, destacado }: { label: string; value: string; destacado?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 shadow-sm ${
        destacado ? "border-[#4FAEB2] bg-[#4FAEB2]/5" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 break-words text-lg font-bold tabular-nums leading-tight text-slate-900">
        {value}
      </div>
    </div>
  );
}

export default function VendedorCierrePage() {
  const params = useParams();
  const id = String(params?.vendedorId ?? "");

  const [desde, setDesde] = useState(hoyYmd());
  const [hasta, setHasta] = useState(hoyYmd());
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);

  const cargar = useCallback(async () => {
    if (!id) return;
    setCargando(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/vendedores/${id}/cierres?desde=${desde}&hasta=${hasta}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: Datos;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "No se pudo cargar.");
      }
      setData(json.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar.");
    } finally {
      setCargando(false);
    }
  }, [id, desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cerrarCaja() {
    if (!data) return;
    const p = data.pendiente;
    const confirmar = window.confirm(
      `Vas a cerrar ${p.ventas} venta(s) por ${gs(p.monto)}.\n\n` +
        "Esas ventas quedan rendidas y no van a entrar en otro cierre. No se puede deshacer.\n\n¿Confirmás?"
    );
    if (!confirmar) return;

    setCerrando(true);
    setErr(null);
    setAviso(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/vendedores/${id}/cierres`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desde, hasta }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { cierre: Cierre };
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "No se pudo realizar el cierre.");
      }
      setAviso(
        `Cierre realizado: ${json.data.cierre.ventas} venta(s), ${gs(json.data.cierre.monto)}.`
      );
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo realizar el cierre.");
    } finally {
      setCerrando(false);
    }
  }

  const p = data?.pendiente;
  const hayPendiente = (p?.ventas ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:py-6">
      <Link href="/vendedores" className="inline-block py-1 text-sm text-[#4FAEB2] hover:underline">
        ← Vendedores
      </Link>

      <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Cierre de caja</h1>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Desde</span>
          <input
            type="date"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde}
            onChange={(e) => setHasta(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          />
        </label>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}
      {aviso && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {aviso}
        </div>
      )}

      {cargando && !data && <p className="text-sm text-slate-500">Cargando…</p>}

      {data && p && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
              Sin rendir en el período
            </h2>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Kpi label="Ventas" value={num(p.ventas)} />
              <Kpi label="Boletas" value={num(p.boletas)} />
              <Kpi label="Monto" value={gs(p.monto)} destacado />
              <Kpi label="Efectivo" value={gs(p.monto_efectivo)} />
            </div>
            {data.total.ventas !== p.ventas && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                En el período hay {num(data.total.ventas)} venta(s) en total por{" "}
                {gs(data.total.monto)}; la diferencia ya se rindió en un cierre anterior.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void cerrarCaja()}
            disabled={cerrando || !hayPendiente}
            className="w-full rounded-xl bg-[#1e2a5a] py-3.5 text-base font-semibold text-white disabled:opacity-40"
          >
            {cerrando
              ? "Cerrando…"
              : hayPendiente
                ? `Realizar cierre de caja · ${gs(p.monto)}`
                : "Nada pendiente de rendir"}
          </button>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
              Operaciones ({data.operaciones.length})
            </h2>
            {data.operaciones.length === 0 ? (
              <p className="text-sm text-slate-500">Sin ventas en el período.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {data.operaciones.map((o) => (
                  <li key={o.entrada_id} className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">
                        {o.cliente || "(sin nombre)"}
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                        {gs(o.monto)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      <span>{fecha(o.fecha)}</span>
                      {o.numero_orden != null && <span>Orden {o.numero_orden}</span>}
                      <span className="tabular-nums">{num(o.boletas)} boleta(s)</span>
                      {o.pago_metodo && <span>{o.pago_metodo}</span>}
                      {o.cerrada && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                          rendida
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.cierres.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
                Cierres anteriores
              </h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {data.cierres.map((c) => (
                  <li key={c.id} className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-slate-800">
                        {soloFecha(c.periodo_desde)} – {soloFecha(c.periodo_hasta)}
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                        {gs(c.monto)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                      <span className="tabular-nums">
                        {num(c.ventas)} venta(s) · {num(c.boletas)} boleta(s)
                      </span>
                      <span>Cerró {c.cerrado_por_nombre ?? "—"}</span>
                      <span>{fecha(c.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
