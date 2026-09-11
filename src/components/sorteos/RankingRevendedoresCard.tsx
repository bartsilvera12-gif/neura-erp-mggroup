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
  canales?: Canal[];
  serieBot?: Array<{ dia: string; boletas: number; monto: number }>;
};

type Canal = {
  canal: "bot" | "vendedor" | "manual";
  ventas: number;
  boletas: number;
  boletas_hoy: number;
  monto: number;
  pendientes: number;
};

const CANAL: Record<Canal["canal"], { nombre: string; color: string }> = {
  bot: { nombre: "Bot de WhatsApp", color: "#4FAEB2" },
  vendedor: { nombre: "Vendedores", color: "#3B4E9B" },
  manual: { nombre: "Carga manual (ERP)", color: "#94A3B8" },
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

/** Una cifra del bloque del bot, con una nota chica abajo si hace falta. */
function Kpi({
  etiqueta,
  valor,
  nota,
  alerta,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        alerta ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</div>
      <div className="text-lg font-bold tabular-nums text-slate-900">{valor}</div>
      {nota && (
        <div className={`text-[11px] ${alerta ? "font-medium text-amber-800" : "text-slate-500"}`}>
          {nota}
        </div>
      )}
    </div>
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

  const botCanal = useMemo(() => data?.canales?.find((c) => c.canal === "bot") ?? null, [data]);
  const totalBoletasCanales = useMemo(
    () => (data?.canales ?? []).reduce((a, c) => a + c.boletas, 0),
    [data]
  );
  /** «dd/mm» en el eje: el año sobra en una serie de dos semanas. */
  const serieBot = useMemo(
    () =>
      (data?.serieBot ?? []).map((d) => ({
        ...d,
        etiqueta: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`,
      })),
    [data]
  );

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
    /** Segunda hoja con los tres canales, bot incluido: el ranking solo tiene vendedores. */
    if (data.canales?.length) {
      const hojaCanales = XLSX.utils.json_to_sheet(
        data.canales.map((c) => ({
          Canal: CANAL[c.canal].nombre,
          Ventas: c.ventas,
          Boletos: c.boletas,
          "Boletos hoy": c.boletas_hoy,
          "Monto (Gs.)": Math.round(c.monto),
          "Pendientes de revisión": c.pendientes,
        }))
      );
      XLSX.utils.book_append_sheet(libro, hojaCanales, "Por canal");
    }
    const campana = (data.sorteo?.nombre ?? "sorteo").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
    const periodo = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
    XLSX.writeFile(libro, `ranking_${campana}${periodo}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Análisis de rendimiento</h2>
          <p className="text-sm text-slate-500">Ranking y recaudación por vendedor</p>
        </div>
        {/* Desde el dashboard se va a administrar vendedores: alta, PIN y cierre de caja. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/vendedores"
            className="rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-3 py-2 text-sm font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/20"
          >
            👤 Vendedores
          </Link>
          {data?.sorteo && (
            <Link
              href={`/sorteos/${data.sorteo.id}/revendedores`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Links de acceso
            </Link>
          )}
        </div>
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
          {/*
            Ventas del bot. El ranking de abajo es solo de vendedores, así que las compras que
            la gente hace sola por WhatsApp no aparecían en ningún lado del panel.

            Se oculta al filtrar por un vendedor: ahí la pregunta es cómo le va a esa persona, y
            los totales del bot no responden eso.
          */}
          {!vendedorSel && botCanal && (
            <section className="rounded-xl border border-[#4FAEB2]/30 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">🤖 Ventas por el bot</h3>
                <span className="text-xs text-slate-500">
                  {totalBoletasCanales > 0
                    ? `${Math.round((botCanal.boletas / totalBoletasCanales) * 100)}% de las boletas del período`
                    : "Sin ventas en el período"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Kpi etiqueta="Ventas" valor={num(botCanal.ventas)} />
                <Kpi
                  etiqueta="Boletas"
                  valor={num(botCanal.boletas)}
                  nota={botCanal.boletas_hoy > 0 ? `+${num(botCanal.boletas_hoy)} hoy` : undefined}
                />
                <Kpi etiqueta="Recaudado" valor={gs(botCanal.monto)} />
                <Kpi
                  etiqueta="Por revisar"
                  valor={num(botCanal.pendientes)}
                  nota={botCanal.pendientes > 0 ? "comprobantes esperando" : "al día"}
                  alerta={botCanal.pendientes > 0}
                />
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Boletas del bot por día
                  </h4>
                  {serieBot.length === 0 ? (
                    <p className="text-sm text-slate-500">El bot no vendió en el período.</p>
                  ) : (
                    <div style={{ width: "100%", height: 180 }}>
                      <ResponsiveContainer>
                        <BarChart data={serieBot} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                          <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
                          <Tooltip
                            formatter={(v: number) => [`${num(v)} boletas`, "Bot"]}
                            labelFormatter={(l) => `Día ${l}`}
                          />
                          <Bar dataKey="boletas" fill={CANAL.bot.color} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Por canal
                  </h4>
                  <ul className="space-y-2.5">
                    {(data.canales ?? []).map((c) => {
                      const pct = totalBoletasCanales > 0 ? (c.boletas / totalBoletasCanales) * 100 : 0;
                      return (
                        <li key={c.canal}>
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="font-medium text-slate-800">{CANAL[c.canal].nombre}</span>
                            <span className="tabular-nums text-slate-600">
                              {num(c.boletas)} u. · {gs(c.monto)}
                            </span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: CANAL[c.canal].color }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </section>
          )}


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
