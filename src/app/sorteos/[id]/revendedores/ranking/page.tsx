"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSorteoById } from "@/lib/sorteos/actions";
import {
  getRevendedoresRanking,
  type RevendedoresRanking,
} from "@/lib/sorteos/revendedores-ranking-actions";

const PYG = new Intl.NumberFormat("es-PY");
function gs(n: number): string {
  return "₲ " + PYG.format(Math.round(n || 0));
}
function num(n: number): string {
  return PYG.format(Math.round(n || 0));
}

/** Oro, plata y bronce para el podio; del cuarto en adelante, gris. */
function medalla(pos: number): string {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return "";
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#4FAEB2]/45 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function RevendedoresRankingPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nombreSorteo, setNombreSorteo] = useState("");
  const [data, setData] = useState<RevendedoresRanking | null>(null);

  const cargar = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [sorteo, ranking] = await Promise.all([
        getSorteoById(id).catch(() => null),
        getRevendedoresRanking(id),
      ]);
      setNombreSorteo(sorteo?.nombre ?? "");
      setData(ranking);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el ranking.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filas = data?.revendedores ?? [];
  /** El máximo marca el 100% de la barra; con todo en cero no se divide. */
  const tope = filas.reduce((m, f) => Math.max(m, f.boletas), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/sorteos/${id}/revendedores`}
            className="text-sm text-[#4FAEB2] hover:underline"
          >
            ← Revendedores
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Ranking de vendedores</h1>
          {nombreSorteo && <p className="text-sm text-slate-500">{nombreSorteo}</p>}
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data && <p className="text-sm text-slate-500">Cargando…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Boletas hoy" value={num(data.totales.boletas_hoy)} sub="Vendidas hoy" />
            <Kpi label="Boletas total" value={num(data.totales.boletas)} sub="Por revendedores" />
            <Kpi label="Ventas" value={num(data.totales.ventas)} sub="Operaciones" />
            <Kpi label="Monto" value={gs(data.totales.monto)} sub="Recaudado" />
          </div>

          {filas.length === 0 ? (
            <p className="text-sm text-slate-500">
              Todavía no hay revendedores cargados en este sorteo.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#4FAEB2]/45 bg-white shadow-sm">
              <ul className="divide-y divide-slate-100">
                {filas.map((f, i) => {
                  const pos = i + 1;
                  const pct = tope > 0 ? Math.round((f.boletas / tope) * 100) : 0;
                  return (
                    <li key={f.revendedor_id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-8 shrink-0 text-center text-sm font-bold text-slate-400">
                            {medalla(pos) || pos}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">
                              {f.nombre}
                              {!f.activo && (
                                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                                  inactivo
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {num(f.ventas)} {f.ventas === 1 ? "venta" : "ventas"} · {gs(f.monto)}
                              {f.boletas_hoy > 0 && (
                                <span className="text-emerald-700"> · +{num(f.boletas_hoy)} hoy</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-bold text-slate-900">{num(f.boletas)}</div>
                          <div className="text-[11px] uppercase tracking-wide text-slate-400">
                            boletas
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#4FAEB2]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Cuenta los cupones emitidos, con el mismo criterio que el panel de sorteos: se
            excluyen las ventas rechazadas. «Hoy» usa el día calendario de Paraguay.
          </p>
        </>
      )}
    </div>
  );
}
