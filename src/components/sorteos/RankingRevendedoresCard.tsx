"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Fila = {
  revendedor_id: string;
  nombre: string;
  activo: boolean;
  boletas: number;
  boletas_hoy: number;
  ventas: number;
  monto: number;
};

type Payload = {
  sorteo: { id: string; nombre: string } | null;
  revendedores: Fila[];
  totales: { boletas: number; boletas_hoy: number; ventas: number; monto: number } | null;
};

const PYG = new Intl.NumberFormat("es-PY");
const num = (n: number) => PYG.format(Math.round(n || 0));
const gs = (n: number) => "₲ " + num(n);

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

/** Cuántos entran en la tarjeta compacta; en panel se listan todos. */
const TOPE_TARJETA = 5;

/**
 * Ranking de vendedores del sorteo activo.
 *
 * `variante="panel"` es el contenido de la pestaña Sorteos del dashboard: para un cliente que
 * solo hace sorteos, esa puede ser la única vista y entonces el dashboard es esto.
 * `variante="tarjeta"` es el resumen compacto para acompañar otras vistas.
 *
 * En cualquier caso, sin sorteo activo o sin revendedores no renderiza nada: una tarjeta vacía
 * en el dashboard es ruido, y este componente vive en un código compartido por muchos ERP.
 */
export default function RankingRevendedoresCard({
  variante = "tarjeta",
}: {
  variante?: "tarjeta" | "panel";
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/sorteos/revendedores/ranking-activo", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { success?: boolean; data?: Payload };
        if (!cancelado && json.success && json.data) setData(json.data);
      } catch {
        /* el dashboard no debe romperse por este widget */
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const esPanel = variante === "panel";

  if (cargando) {
    return esPanel ? <p className="text-sm text-slate-500">Cargando ranking…</p> : null;
  }
  if (!data?.sorteo) {
    return esPanel ? (
      <p className="text-sm text-slate-500">No hay ningún sorteo activo.</p>
    ) : null;
  }
  if (data.revendedores.length === 0) {
    return esPanel ? (
      <p className="text-sm text-slate-500">
        Este sorteo todavía no tiene vendedores cargados.
      </p>
    ) : null;
  }

  const filas = esPanel ? data.revendedores : data.revendedores.slice(0, TOPE_TARJETA);
  const tope = filas.reduce((m, f) => Math.max(m, f.boletas), 0);

  const lista = (
    <ul className={esPanel ? "divide-y divide-slate-100" : "mt-3 space-y-2.5"}>
      {filas.map((f, i) => {
        const pos = i + 1;
        const pct = tope > 0 ? Math.round((f.boletas / tope) * 100) : 0;
        return (
          <li key={f.revendedor_id} className={esPanel ? "px-1 py-3" : undefined}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-400">
                  {medalla(pos) || pos}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">
                    {f.nombre}
                    {!f.activo && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                        inactivo
                      </span>
                    )}
                  </span>
                  {esPanel && (
                    <span className="block text-xs text-slate-500">
                      {num(f.ventas)} {f.ventas === 1 ? "venta" : "ventas"} · {gs(f.monto)}
                    </span>
                  )}
                </span>
                {f.boletas_hoy > 0 && (
                  <span className="shrink-0 text-xs text-emerald-700">
                    +{num(f.boletas_hoy)} hoy
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-bold text-slate-900">{num(f.boletas)}</span>
                {esPanel && (
                  <span className="block text-[11px] uppercase tracking-wide text-slate-400">
                    boletas
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (esPanel) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Ranking de vendedores</h2>
            <p className="text-sm text-slate-500">{data.sorteo.nombre}</p>
          </div>
          <Link
            href={`/sorteos/${data.sorteo.id}/revendedores`}
            className="text-sm font-medium text-[#4FAEB2] hover:underline"
          >
            Administrar vendedores →
          </Link>
        </div>

        {data.totales && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Boletas hoy" value={num(data.totales.boletas_hoy)} sub="Vendidas hoy" />
            <Kpi label="Boletas total" value={num(data.totales.boletas)} sub="Por vendedores" />
            <Kpi label="Ventas" value={num(data.totales.ventas)} sub="Operaciones" />
            <Kpi label="Monto" value={gs(data.totales.monto)} sub="Recaudado" />
          </div>
        )}

        <div className="rounded-2xl border border-[#4FAEB2]/45 bg-white px-4 py-2 shadow-sm">
          {lista}
        </div>

        <p className="text-[11px] text-slate-500">
          Cuenta los cupones emitidos, con el mismo criterio que el panel de sorteos: se excluyen
          las ventas rechazadas. «Hoy» usa el día calendario de Paraguay.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[#4FAEB2]/45 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            🏆 Ranking de vendedores
          </h2>
          <p className="text-sm text-slate-500">{data.sorteo.nombre}</p>
        </div>
        <Link
          href={`/sorteos/${data.sorteo.id}/revendedores/ranking`}
          className="text-sm font-medium text-[#4FAEB2] hover:underline"
        >
          Ver todo →
        </Link>
      </div>

      {data.totales && (
        <div className="mt-3 flex flex-wrap gap-4 border-b border-slate-100 pb-3 text-sm">
          <span className="text-slate-600">
            Hoy <strong className="text-slate-900">{num(data.totales.boletas_hoy)}</strong> boletas
          </span>
          <span className="text-slate-600">
            Total <strong className="text-slate-900">{num(data.totales.boletas)}</strong>
          </span>
          <span className="text-slate-600">
            Recaudado <strong className="text-slate-900">{gs(data.totales.monto)}</strong>
          </span>
        </div>
      )}

      {lista}
    </section>
  );
}
