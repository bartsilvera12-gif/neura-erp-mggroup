"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Fila = {
  revendedor_id: string;
  nombre: string;
  boletas: number;
  boletas_hoy: number;
  monto: number;
};

type Payload = {
  sorteo: { id: string; nombre: string } | null;
  revendedores: Fila[];
  totales: { boletas: number; boletas_hoy: number; monto: number } | null;
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

/**
 * Top de vendedores del sorteo activo, para el dashboard.
 *
 * Se monta con `TOPE` filas: el dashboard es una vista de un vistazo, y el listado completo
 * vive en su propia pantalla. Si no hay sorteo activo o no hay revendedores, no renderiza
 * nada: una tarjeta vacía en el dashboard es ruido.
 */
const TOPE = 5;

export default function RankingRevendedoresCard() {
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

  if (cargando || !data?.sorteo || data.revendedores.length === 0) return null;

  const filas = data.revendedores.slice(0, TOPE);
  const tope = filas.reduce((m, f) => Math.max(m, f.boletas), 0);

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

      <ul className="mt-3 space-y-2.5">
        {filas.map((f, i) => {
          const pos = i + 1;
          const pct = tope > 0 ? Math.round((f.boletas / tope) * 100) : 0;
          return (
            <li key={f.revendedor_id}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-400">
                    {medalla(pos) || pos}
                  </span>
                  <span className="truncate font-medium text-slate-800">{f.nombre}</span>
                  {f.boletas_hoy > 0 && (
                    <span className="shrink-0 text-xs text-emerald-700">+{num(f.boletas_hoy)} hoy</span>
                  )}
                </span>
                <span className="shrink-0 font-bold text-slate-900">{num(f.boletas)}</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
