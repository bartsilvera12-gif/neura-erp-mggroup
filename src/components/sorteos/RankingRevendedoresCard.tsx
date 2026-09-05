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
      {/* `tabular-nums` + quiebre: en celular los montos en guaraníes son largos. */}
      <div className="mt-0.5 break-words text-lg font-bold tabular-nums leading-tight text-slate-900 sm:text-2xl">
        {value}
      </div>
      {sub && <div className="mt-0.5 hidden text-xs text-slate-500 sm:block">{sub}</div>}
    </div>
  );
}

/** Cuántos entran en la tarjeta compacta; en panel se listan todos. */
const TOPE_TARJETA = 5;

/** En el panel la fila entera es un enlace al cierre de caja; en la tarjeta, no. */
function ItemEnvoltorio({
  esPanel,
  revendedorId,
  children,
}: {
  esPanel: boolean;
  revendedorId: string;
  children: React.ReactNode;
}) {
  if (!esPanel) return <>{children}</>;
  return (
    <Link href={`/vendedores/${revendedorId}`} className="block rounded-lg hover:bg-slate-50">
      {children}
    </Link>
  );
}

/**
 * Ranking de vendedores por boletas vendidas.
 *
 * `variante="panel"` es la vista Sorteos del dashboard y la pantalla dedicada; `"tarjeta"` es
 * el resumen compacto para acompañar otras vistas. Con `sorteoId` muestra ese sorteo; sin él,
 * el sorteo activo.
 *
 * Sin sorteo o sin revendedores, la tarjeta no renderiza nada (una tarjeta vacía en el
 * dashboard es ruido) y el panel explica por qué está vacío.
 */
export default function RankingRevendedoresCard({
  variante = "tarjeta",
  sorteoId,
  sorteoNombre,
}: {
  variante?: "tarjeta" | "panel";
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
        /* el dashboard no debe romperse por este widget */
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [sorteoId]);

  const esPanel = variante === "panel";
  const sorteo = data?.sorteo ?? (sorteoId ? { id: sorteoId, nombre: sorteoNombre ?? "" } : null);

  if (cargando) {
    return esPanel ? <p className="text-sm text-slate-500">Cargando ranking…</p> : null;
  }
  if (!data || !sorteo) {
    return esPanel ? <p className="text-sm text-slate-500">No hay ningún sorteo activo.</p> : null;
  }
  if (data.revendedores.length === 0) {
    return esPanel ? (
      <p className="text-sm text-slate-500">Este sorteo todavía no tiene vendedores cargados.</p>
    ) : null;
  }

  const filas = esPanel ? data.revendedores : data.revendedores.slice(0, TOPE_TARJETA);
  const tope = filas.reduce((m, f) => Math.max(m, f.boletas), 0);

  /**
   * Una fila por vendedor. El nombre se corta y las boletas quedan siempre visibles a la
   * derecha; el resto de los datos baja a una línea que envuelve. En pantallas angostas eso
   * evita que el nombre y el monto se peleen el ancho en el mismo renglón.
   */
  const lista = (
    <ul className={esPanel ? "divide-y divide-slate-100" : "mt-3 space-y-3"}>
      {filas.map((f, i) => {
        const pos = i + 1;
        const pct = tope > 0 ? Math.round((f.boletas / tope) * 100) : 0;
        return (
          <li key={f.revendedor_id} className={esPanel ? "py-3" : undefined}>
            {/* En el panel cada vendedor lleva a su cierre de caja, que es a donde se va
                después de mirar el ranking. En la tarjeta compacta no, para no llenar el
                dashboard de enlaces. */}
            <ItemEnvoltorio esPanel={esPanel} revendedorId={f.revendedor_id}>
            <div className="flex items-start gap-2.5">
              <span className="w-6 shrink-0 pt-0.5 text-center text-sm font-bold text-slate-400">
                {medalla(pos) || pos}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-slate-800">{f.nombre}</span>
                  <span className="shrink-0 font-bold tabular-nums text-slate-900">
                    {num(f.boletas)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  {esPanel && (
                    <span className="tabular-nums">
                      {num(f.ventas)} {f.ventas === 1 ? "venta" : "ventas"} · {gs(f.monto)}
                    </span>
                  )}
                  {f.boletas_hoy > 0 && (
                    <span className="font-medium tabular-nums text-emerald-700">
                      +{num(f.boletas_hoy)} hoy
                    </span>
                  )}
                  {!f.activo && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                      inactivo
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
            </ItemEnvoltorio>
          </li>
        );
      })}
    </ul>
  );

  if (esPanel) {
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

        <div className="rounded-xl border border-[#4FAEB2]/45 bg-white px-3 py-1 shadow-sm sm:rounded-2xl sm:px-4">
          {lista}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Cuenta los cupones emitidos, con el mismo criterio que el panel de sorteos: se excluyen
          las ventas rechazadas. «Hoy» usa el día calendario de Paraguay.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[#4FAEB2]/45 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            🏆 Ranking de vendedores
          </h2>
          {sorteo.nombre && <p className="truncate text-sm text-slate-500">{sorteo.nombre}</p>}
        </div>
        <Link
          href={`/sorteos/${sorteo.id}/revendedores/ranking`}
          className="shrink-0 py-1 text-sm font-medium text-[#4FAEB2] hover:underline"
        >
          Ver todo →
        </Link>
      </div>

      {data.totales && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 pb-3 text-sm">
          <span className="text-slate-600">
            Hoy{" "}
            <strong className="tabular-nums text-slate-900">{num(data.totales.boletas_hoy)}</strong>
          </span>
          <span className="text-slate-600">
            Total <strong className="tabular-nums text-slate-900">{num(data.totales.boletas)}</strong>
          </span>
          <span className="text-slate-600">
            Recaudado{" "}
            <strong className="tabular-nums text-slate-900">{gs(data.totales.monto)}</strong>
          </span>
        </div>
      )}

      {lista}
    </section>
  );
}
