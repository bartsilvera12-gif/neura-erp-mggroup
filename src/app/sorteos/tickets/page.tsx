"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getSorteos } from "@/lib/sorteos/actions";
import type { Sorteo } from "@/lib/sorteos/types";
import {
  boletosDeEntrega,
  leerImagenesDeBoleto,
  resumirImagenes,
  type EstadoImagenBoleto,
} from "@/lib/sorteos/sorteo-ticket-imagenes";

/** Sorteo actual por defecto: activo más reciente; si no hay activo, el más reciente. */
function pickDefaultSorteoIdClient(sorteos: Sorteo[]): string {
  if (!sorteos.length) return "";
  const recency = (s: Sorteo): number => {
    const t = s.fecha_sorteo ?? s.created_at;
    const n = t ? Date.parse(t) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  const sorted = [...sorteos].sort((a, b) => recency(b) - recency(a));
  const activo = sorted.find((s) => s.estado === "activo");
  return (activo ?? sorted[0]).id;
}

type TicketRow = {
  id: string;
  sorteo_id: string;
  entrada_id: string;
  status: string;
  cliente_nombre: string | null;
  cliente_documento: string | null;
  telefono: string | null;
  numero_orden: string | null;
  created_at: string;
  error_message?: string | null;
  payload_snapshot?: unknown;
  storage_path?: string | null;
};

/** Color de cada boleto según lo que avisó Meta: se ve de un vistazo cuál no llegó. */
function chipBoleto(estado: EstadoImagenBoleto | null): string {
  if (estado === "delivered" || estado === "read") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
  }
  if (estado === "failed") return "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100";
  return "border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
}

function tituloBoleto(estado: EstadoImagenBoleto | null): string {
  if (estado === "read") return "Leído por el cliente";
  if (estado === "delivered") return "Entregado";
  if (estado === "failed") return "No llegó";
  if (estado === "sent" || estado === "aceptado") return "Enviado, sin confirmar la entrega";
  return "Sin estado registrado";
}

const INPUT_CLS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const SELECT_CLS =
  "w-full appearance-none rounded-xl border border-slate-200 bg-white bg-[length:14px_14px] bg-[right_0.7rem_center] bg-no-repeat px-3 py-2 pr-8 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const CHEVRON_STYLE = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%234FAEB2' stroke-width='2.5'><path stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/></svg>\")",
} as const;
const LABEL_CLS =
  "block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-1.5";

type StatusMeta = { label: string; chip: string; dot: string };
const STATUS_META: Record<string, StatusMeta> = {
  pending: {
    label: "Pendiente",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
  generated: {
    label: "Generado",
    chip: "border-[#4FAEB2]/30 bg-[#4FAEB2]/10 text-[#3F8E91]",
    dot: "bg-[#4FAEB2]",
  },
  sent: {
    label: "Enviado",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  error: {
    label: "Error",
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
  },
};
function statusMeta(value: string): StatusMeta {
  return (
    STATUS_META[value] ?? {
      label: value,
      chip: "border-slate-200 bg-slate-50 text-slate-600",
      dot: "bg-slate-400",
    }
  );
}

export default function SorteosTicketsPage() {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sorteos, setSorteos] = useState<Sorteo[]>([]);
  const [sorteoId, setSorteoId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function load(sorteoOverride?: string) {
    setLoading(true);
    setErr(null);
    try {
      // sid: uuid (un sorteo), "all" (todos), o "" (deja que el server resuelva el actual).
      const sid = (sorteoOverride ?? sorteoId).trim();
      const sp = new URLSearchParams();
      if (sid) sp.set("sorteo_id", sid);
      if (status.trim()) sp.set("status", status.trim());
      if (q.trim()) sp.set("q", q.trim());
      const res = await fetchWithSupabaseSession(`/api/sorteos/tickets?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { success?: boolean; data?: TicketRow[]; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error?.trim() || `No se pudo cargar (${res.status})`);
      }
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Carga inicial: resolver el sorteo actual por defecto y traer solo sus tickets.
    void (async () => {
      let initialSorteoId = "";
      try {
        const list = await getSorteos();
        setSorteos(list);
        initialSorteoId = pickDefaultSorteoIdClient(list);
        setSorteoId(initialSorteoId);
      } catch {
        // Si falla la lista, el server resuelve el sorteo actual igualmente.
      }
      await load(initialSorteoId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial; filtros con botón Filtrar
  }, []);

  /** `n`: qué foto de la compra abrir (1 = primer boleto). */
  async function openSignedUrl(ticketId: string, n = 1) {
    setBusyId(ticketId);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/sorteos/tickets/${encodeURIComponent(ticketId)}/signed-url?ttl=600&n=${n}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { success?: boolean; data?: { url?: string }; error?: string };
      if (!res.ok || !json.success || !json.data?.url) {
        throw new Error(json.error || "Sin URL");
      }
      window.open(json.data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al obtener URL firmada");
    } finally {
      setBusyId(null);
    }
  }

  /** Sin `boleto`: los que no llegaron. Con `boleto`: solo ese. */
  async function resendTicket(ticketId: string, boleto?: { n: number; numero: string }) {
    setAviso(null);
    const pregunta = boleto
      ? `¿Reenviar por WhatsApp solo el boleto N.º ${boleto.numero}?`
      : "¿Reenviar por WhatsApp los boletos que no le llegaron al cliente? Si le llegaron todos, se le mandan todos de nuevo.";
    if (!confirm(pregunta)) return;
    setBusyId(ticketId);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/sorteos/tickets/${encodeURIComponent(ticketId)}/resend`, {
        method: "POST",
        ...(boleto
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: [boleto.n] }) }
          : {}),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { enviadas?: number; numeros?: string[] };
      };
      if (!res.ok || !json.success) throw new Error(json.error || "Falló reenvío");
      await load();
      const numeros = json.data?.numeros ?? [];
      if (numeros.length > 0) {
        setAviso(`Reenviado: ${numeros.length === 1 ? "boleto" : "boletos"} N.º ${numeros.join(", ")}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function regenerateTicket(ticketId: string) {
    if (!confirm("¿Regenerar el PNG (nueva revisión)? No se reenvía solo.")) return;
    setBusyId(ticketId);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/sorteos/tickets/${encodeURIComponent(ticketId)}/regenerate`, {
        method: "POST",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "Falló regeneración");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/sorteos" className="font-medium text-slate-500 transition-colors hover:text-[#4FAEB2]">
          Sorteos
        </Link>
        <span aria-hidden className="text-slate-300">
          /
        </span>
        <span className="font-semibold text-slate-700">Tickets</span>
      </nav>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
          />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Sorteos · Tickets
          </p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Tickets / Comprobantes
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Registro de generación y envío de comprobantes en imagen tras confirmar compras en WhatsApp.
        </p>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-[#4FAEB2]/45 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="block h-5 w-1 rounded-full bg-[#4FAEB2]" />
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" />
            Filtros
          </h3>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-[16rem]">
            <label className={LABEL_CLS}>Sorteo</label>
            <select
              className={SELECT_CLS}
              style={CHEVRON_STYLE}
              value={sorteoId}
              onChange={(e) => {
                const v = e.target.value;
                setSorteoId(v);
                void load(v);
              }}
            >
              {sorteos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                  {s.estado === "activo" ? " (activo)" : ""}
                </option>
              ))}
              <option value="all">Todos los sorteos</option>
            </select>
          </div>
          <div className="w-[12rem]">
            <label className={LABEL_CLS}>Estado</label>
            <select
              className={SELECT_CLS}
              style={CHEVRON_STYLE}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="generated">Generado</option>
              <option value="sent">Enviado</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="min-w-[14rem] flex-1">
            <label className={LABEL_CLS}>Buscar</label>
            <input
              className={INPUT_CLS}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, doc o teléfono…"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
          >
            Filtrar
          </button>
          {sorteoId || status || q ? (
            <button
              type="button"
              onClick={() => {
                setSorteoId("");
                setStatus("");
                setQ("");
                void load();
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91]"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {err}
        </div>
      ) : null}

      {aviso ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {aviso}
        </div>
      ) : null}

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-[#4FAEB2]/45 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="block h-5 w-1 rounded-full bg-[#4FAEB2]" />
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" />
              Tickets
            </h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#3F8E91]">
            {rows.length}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
            Cargando tickets…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Orden</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Doc / Tel</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const meta = statusMeta(r.status);
                  const boletos = resumirImagenes(leerImagenesDeBoleto(r.payload_snapshot));
                  const porBoleto = boletosDeEntrega(r.payload_snapshot, r.storage_path);
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-[#4FAEB2]/5">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}
                        >
                          <span aria-hidden="true" className={`h-1 w-1 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                        {/* Con varias fotos, cuántas llegaron de verdad al teléfono y cuál no. */}
                        {boletos.total > 1 || boletos.fallidas > 0 ? (
                          <div className="mt-1 text-[11px] leading-snug text-slate-500">
                            {boletos.entregadas}/{boletos.total} entregados
                            {boletos.sin_confirmar > 0 ? ` · ${boletos.sin_confirmar} sin confirmar` : ""}
                          </div>
                        ) : null}
                        {boletos.numeros_fallidos.length > 0 ? (
                          <div className="text-[11px] font-semibold leading-snug text-rose-600">
                            No llegó: N.º {boletos.numeros_fallidos.join(", ")}
                          </div>
                        ) : r.status === "error" && r.error_message ? (
                          <div className="max-w-[16rem] text-[11px] leading-snug text-rose-600">
                            {r.error_message}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono font-semibold text-slate-800">
                        {r.numero_orden ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{r.cliente_nombre ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {(r.cliente_documento ?? "").trim() || "—"}
                        <span className="text-slate-300"> / </span>
                        {(r.telefono ?? "").trim() || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === r.id || r.status === "pending"}
                            onClick={() => void openSignedUrl(r.id)}
                            className="inline-flex items-center rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/8 px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/12 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busyId === r.id ? "…" : "Ver / descargar"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void resendTicket(r.id)}
                            className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reenviar WA
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void regenerateTicket(r.id)}
                            className="inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Regenerar
                          </button>
                        </div>
                        {porBoleto.length > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              Ver:
                            </span>
                            {porBoleto.map((b) => (
                              <button
                                key={b.n}
                                type="button"
                                disabled={busyId === r.id}
                                title={`Abrir la imagen del boleto ${b.numero}`}
                                onClick={() => void openSignedUrl(r.id, b.n)}
                                className="inline-flex items-center rounded-md border border-[#4FAEB2]/30 bg-[#4FAEB2]/8 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/12 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {b.numero}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {porBoleto.length > 0 ? (
                          <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              Reenviar uno:
                            </span>
                            {porBoleto.map((b) => (
                              <button
                                key={b.n}
                                type="button"
                                disabled={busyId === r.id}
                                title={`Boleto ${b.n} de ${porBoleto.length} · ${tituloBoleto(b.estado)}`}
                                onClick={() => void resendTicket(r.id, b)}
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${chipBoleto(b.estado)}`}
                              >
                                {b.numero}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                      Sin registros
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
