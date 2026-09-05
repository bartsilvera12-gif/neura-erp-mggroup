"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

type Datos = {
  sorteos: Array<{ id: string; nombre: string; estado: string }>;
  sorteo: { id: string; nombre: string } | null;
  revendedores: Fila[];
  totales: { boletas: number; boletas_hoy: number; ventas: number; monto: number } | null;
  progreso: { vendidas: number; maximo: number | null; restante: number | null } | null;
};

const PYG = new Intl.NumberFormat("es-PY");
const num = (n: number) => PYG.format(Math.round(n || 0));
const gs = (n: number) => "₲ " + num(n);

const VERDE = "#22A06B";
const AZUL = "#3B4E9B";
const GRIS = "#E2E8F0";

function medalla(pos: number): string {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return "";
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const CTRL =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#3B4E9B] outline-none focus:border-[#4FAEB2]";

const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const TD = "px-3 py-2.5 align-middle";

/**
 * Panel de estadísticas de vendedores: filtros, recaudación, progreso del sorteo y ranking.
 *
 * Con `sorteoId` queda fijo en ese sorteo (pantalla del sorteo); sin él muestra el selector de
 * campaña y arranca en el activo (dashboard).
 */
export default function RankingRevendedoresCard({ sorteoId }: { sorteoId?: string }) {
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [sorteoSel, setSorteoSel] = useState(sorteoId ?? "");
  const [vendedorSel, setVendedorSel] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (sorteoSel) q.set("sorteo_id", sorteoSel);
      if (vendedorSel) q.set("vendedor_id", vendedorSel);
      if (desde) q.set("desde", desde);
      if (hasta) q.set("hasta", hasta);
      const res = await fetchWithSupabaseSession(`/api/sorteos/estadisticas?${q}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: Datos;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "No se pudieron cargar las estadísticas.");
      }
      setData(json.data);
      if (!sorteoSel && json.data.sorteo) setSorteoSel(json.data.sorteo.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudieron cargar las estadísticas.");
    } finally {
      setCargando(false);
    }
  }, [sorteoSel, vendedorSel, desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Lista completa para el selector de vendedor. Se guarda aparte porque al filtrar por uno
   * solo la respuesta trae únicamente ese, y el selector quedaría con una sola opción.
   */
  const [todosVendedores, setTodosVendedores] = useState<Array<{ id: string; nombre: string }>>([]);
  useEffect(() => {
    if (!vendedorSel && data?.revendedores) {
      setTodosVendedores(
        data.revendedores.map((r) => ({ id: r.revendedor_id, nombre: r.nombre }))
      );
    }
  }, [data, vendedorSel]);

  /** Memorizado para que el cálculo de las barras no se rehaga en cada render. */
  const filas = useMemo(() => data?.revendedores ?? [], [data]);

  /** Solo los que vendieron: una barra en cero no aporta y ensucia la escala. */
  const barras = useMemo(
    () => filas.filter((f) => f.monto > 0).slice(0, 8).map((f) => ({ nombre: f.nombre, monto: f.monto })),
    [filas]
  );

  const dona = useMemo(() => {
    const p = data?.progreso;
    if (!p || p.maximo == null) return null;
    return [
      { name: "Vendido", value: p.vendidas },
      { name: "Restante", value: Math.max(0, p.restante ?? 0) },
    ];
  }, [data]);

  async function exportarExcel() {
    if (!data) return;
    /** Carga diferida: la librería pesa y solo hace falta cuando alguien exporta. */
    const XLSX = await import("xlsx");
    const filasXls = filas.map((f, i) => ({
      Puesto: i + 1,
      Vendedor: f.nombre,
      Ventas: f.ventas,
      Boletos: f.boletas,
      "Boletos hoy": f.boletas_hoy,
      "Monto (Gs.)": Math.round(f.monto),
      Estado: f.activo ? "activo" : "inactivo",
    }));
    const hoja = XLSX.utils.json_to_sheet(filasXls);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Ranking");
    const campana = (data.sorteo?.nombre ?? "sorteo").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
    const periodo = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
    XLSX.writeFile(libro, `ranking_${campana}${periodo}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Análisis de rendimiento</h2>
        <p className="text-sm text-slate-500">Ranking y recaudación por vendedor</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!sorteoId && (
            <Campo label="🏷 Campaña">
              <select
                className={CTRL}
                value={sorteoSel}
                onChange={(e) => setSorteoSel(e.target.value)}
              >
                {(data?.sorteos ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                    {s.estado !== "activo" ? ` (${s.estado})` : ""}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          <Campo label="👤 Vendedor">
            <select
              className={CTRL}
              value={vendedorSel}
              onChange={(e) => setVendedorSel(e.target.value)}
            >
              <option value="">Todos</option>
              {todosVendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="📅 Desde">
            <input
              type="date"
              className={CTRL}
              value={desde}
              max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
            />
          </Campo>
          <Campo label="📅 Hasta">
            <input
              type="date"
              className={CTRL}
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
            />
          </Campo>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportarExcel()}
            disabled={filas.length === 0}
            className="flex-1 rounded-lg bg-[#22A06B] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none"
          >
            Exportar a Excel
          </button>
          {(desde || hasta || vendedorSel) && (
            <button
              type="button"
              onClick={() => {
                setDesde("");
                setHasta("");
                setVendedorSel("");
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}
      {cargando && !data && <p className="text-sm text-slate-500">Cargando…</p>}

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Top vendedores (recaudación)
              </h3>
              {barras.length === 0 ? (
                <p className="text-sm text-slate-500">Sin ventas en el período.</p>
              ) : (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={barras} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                      <XAxis
                        dataKey="nombre"
                        tick={{ fontSize: 11 }}
                        interval={0}
                        angle={barras.length > 3 ? -20 : 0}
                        textAnchor={barras.length > 3 ? "end" : "middle"}
                        height={barras.length > 3 ? 56 : 24}
                      />
                      <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={(v) => num(v)} />
                      <Tooltip formatter={(v: number) => gs(v)} />
                      <Bar dataKey="monto" fill={AZUL} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Progreso de ventas</h3>
              {!dona ? (
                <p className="text-sm text-slate-500">
                  Este sorteo no tiene tope de boletas configurado.
                </p>
              ) : (
                <>
                  <div style={{ width: "100%", height: 200 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={dona}
                          dataKey="value"
                          innerRadius="60%"
                          outerRadius="85%"
                          startAngle={90}
                          endAngle={-270}
                        >
                          <Cell fill={VERDE} />
                          <Cell fill={GRIS} />
                        </Pie>
                        <Tooltip formatter={(v: number) => `${num(v)} boletas`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-4 text-xs text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-4 rounded" style={{ background: VERDE }} />
                      Vendido {num(data.progreso?.vendidas ?? 0)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-4 rounded" style={{ background: GRIS }} />
                      Restante {num(data.progreso?.restante ?? 0)}
                    </span>
                  </div>
                </>
              )}
            </section>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Ranking detallado</h3>
            {filas.length === 0 ? (
              <p className="text-sm text-slate-500">Sin vendedores para este filtro.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[540px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left">
                      <th className={`${TH} w-20`}>Puesto</th>
                      <th className={TH}>Vendedor</th>
                      <th className={`${TH} text-right`}>Ventas</th>
                      <th className={`${TH} text-right`}>Tickets</th>
                      <th className={`${TH} text-right`}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr
                        key={f.revendedor_id}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                      >
                        <td className={`${TD} whitespace-nowrap font-bold text-slate-500`}>
                          <span className="mr-1">{medalla(i + 1)}</span>
                          {i + 1}
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
                          {num(f.boletas)} u.
                        </td>
                        <td
                          className={`${TD} whitespace-nowrap text-right tabular-nums text-slate-700`}
                        >
                          {gs(f.monto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Tocá un vendedor para ver su detalle y hacer el cierre de caja. Cuenta los cupones
            emitidos, excluyendo ventas rechazadas. «Hoy» usa el día calendario de Paraguay.
          </p>
        </>
      )}
    </div>
  );
}
