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
  sorteo?: { id: string; nombre: string } | null;
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
    <div className="rounded-xl border border-[#4FAEB2]/45 bg-white p-3 shadow-sm sm:rounded-2xl sm:p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-[11px]">
        {label}
      </div>
      <div className="mt-0.5 break-words text-lg font-bold tabular-nums leading-tight text-slate-900 sm:text-2xl">
        {value}
      </div>
      {sub && <div className="mt-0.5 hidden text-xs text-slate-500 sm:block">{sub}</div>}
    </div>
  );
}

const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const TD = "px-3 py-2.5 align-middle";

/**
 * Ranking de vendedores por boletas vendidas, en la tabla que pidió el cliente:
 * Posición · Vendedor · Ventas · Boletos · Monto.
 *
 * Con `sorteoId` muestra ese sorteo; sin él, el sorteo activo. Sin sorteo o sin vendedores no
 * renderiza la tabla: este componente vive en un código compartido por muchos ERP.
 */
export default function RankingRevendedoresCard({
  sorteoId,
  sorteoNombre,
}: {
  sorteoId?: string;
  sorteoNombre?: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    const url = sorteoId
      ? `/api/sorteos/${encodeURIComponent(sorteoId)}/revendedores/ranking`
      : "/api/sorteos/revendedores/ranking-activo";
    (async () => {
      try {
        const res = await fetchWithSupabaseSession(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { success?: boolean; data?: Payload };
        if (!cancelado && json.success && json.data) setData(json.data);
      } catch {
        /* el dashboard no debe romperse por este panel */
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [sorteoId]);

  const sorteo = data?.sorteo ?? (sorteoId ? { id: sorteoId, nombre: sorteoNombre ?? "" } : null);

  if (cargando) return <p className="text-sm text-slate-500">Cargando ranking…</p>;
  if (!data || !sorteo) return <p className="text-sm text-slate-500">No hay ningún sorteo activo.</p>;
  if (data.revendedores.length === 0) {
    return (
      <p className="text-sm text-slate-500">Este sorteo todavía no tiene vendedores cargados.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Ranking de vendedores</h2>
          {sorteo.nombre && <p className="truncate text-sm text-slate-500">{sorteo.nombre}</p>}
        </div>
        <Link
          href={`/sorteos/${sorteo.id}/revendedores`}
          className="shrink-0 py-1 text-sm font-medium text-[#4FAEB2] hover:underline"
        >
          Vendedores →
        </Link>
      </div>

      {data.totales && (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Kpi label="Boletas hoy" value={num(data.totales.boletas_hoy)} sub="Vendidas hoy" />
          <Kpi label="Boletas total" value={num(data.totales.boletas)} sub="Por vendedores" />
          <Kpi label="Ventas" value={num(data.totales.ventas)} sub="Operaciones" />
          <Kpi label="Monto" value={gs(data.totales.monto)} sub="Recaudado" />
        </div>
      )}

      {/* La tabla scrollea dentro de su caja: en un celular no entran cinco columnas. */}
      <div className="overflow-x-auto rounded-xl border border-[#4FAEB2]/45 bg-white shadow-sm sm:rounded-2xl">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className={`${TH} w-16`}>Pos.</th>
              <th className={TH}>Vendedor</th>
              <th className={`${TH} text-right`}>Ventas</th>
              <th className={`${TH} text-right`}>Boletos</th>
              <th className={`${TH} text-right`}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {data.revendedores.map((f, i) => {
              const pos = i + 1;
              return (
                <tr
                  key={f.revendedor_id}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <td className={`${TD} whitespace-nowrap font-bold text-slate-500`}>
                    <span className="mr-1">{medalla(pos)}</span>
                    {pos}
                  </td>
                  <td className={TD}>
                    <Link
                      href={`/vendedores/${f.revendedor_id}`}
                      className="font-medium text-slate-900 hover:text-[#3F8E91] hover:underline"
                    >
                      {f.nombre}
                    </Link>
                    <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                      {f.boletas_hoy > 0 && (
                        <span className="font-medium text-emerald-700">
                          +{num(f.boletas_hoy)} hoy
                        </span>
                      )}
                      {!f.activo && <span className="uppercase">inactivo</span>}
                    </div>
                  </td>
                  <td className={`${TD} text-right tabular-nums text-slate-700`}>
                    {num(f.ventas)}
                  </td>
                  <td className={`${TD} text-right font-bold tabular-nums text-slate-900`}>
                    {num(f.boletas)}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums text-slate-700`}>
                    {gs(f.monto)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Tocá un vendedor para ver su detalle por fechas y hacer el cierre de caja. Cuenta los
        cupones emitidos, con el mismo criterio que el panel de sorteos: se excluyen las ventas
        rechazadas. «Hoy» usa el día calendario de Paraguay.
      </p>
    </div>
  );
}
