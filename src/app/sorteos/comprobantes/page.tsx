"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { approveComprobanteValidacion } from "@/lib/chat/actions";
import { rejectComprobanteValidacion } from "@/lib/chat/comprobante-revision-actions";
import type { ManualSorteoApprovalResult } from "@/lib/chat/sorteo-manual-approval-service";
import { PRESETS_FECHA_CHAT, describirRangoFechaChat, rangoFechaChat, ymdEnParaguay } from "@/lib/chat/chat-filtro-fecha";
import { DialogoRechazarComprobante } from "@/components/sorteos/DialogoRechazarComprobante";
import {
  esComprobantePendiente,
  type EstadoFiltroComprobantes,
  type FilaComprobanteCompra,
  type ResumenBusqueda,
} from "@/lib/sorteos/comprobantes-compras-tipos";

/**
 * Sorteos → Comprobantes.
 *
 * Dos usos en una pantalla:
 * - Revisar a mano: la pestaña «Pendientes» junta todos los comprobantes que el bot no pudo
 *   dar por buenos, de todas las conversaciones, con Aprobar y Rechazar en cada uno.
 * - Buscar a una persona: por teléfono, CI, nombre o número de boleta aparecen todos sus
 *   comprobantes, con el monto, el estado y las boletas que generó cada pago.
 */

const PYG = new Intl.NumberFormat("es-PY");
const gs = (n: number | null | undefined) => (n == null ? "—" : `Gs. ${PYG.format(Math.round(n))}`);

const ESTADOS_TAB: Array<{ id: EstadoFiltroComprobantes; label: string }> = [
  { id: "pendientes", label: "Pendientes de revisión" },
  { id: "aprobados", label: "Aprobados" },
  { id: "rechazados", label: "Rechazados" },
  { id: "todos", label: "Todos" },
];

type Chip = { label: string; cls: string };
const VERDE = "border-emerald-200 bg-emerald-50 text-emerald-700";
const ROJO = "border-rose-200 bg-rose-50 text-rose-700";
const AMBAR = "border-amber-200 bg-amber-50 text-amber-800";
const GRIS = "border-slate-200 bg-slate-50 text-slate-600";

/** Qué le pasó a este comprobante, en palabras de quien lo revisa. */
function estadoDeFila(f: FilaComprobanteCompra): Chip {
  if (f.tipo === "compra_sin_comprobante") {
    const quien = f.canal === "vendedor" ? "Venta de vendedor" : f.canal === "bot" ? "Venta por WhatsApp" : "Venta manual";
    return f.estado_pago === "rechazado" ? { label: `${quien} · anulada`, cls: ROJO } : { label: quien, cls: GRIS };
  }
  if (f.entrada_id && f.estado_pago === "rechazado") return { label: "Compra anulada", cls: ROJO };
  switch (f.estado_validacion) {
    case "valido":
      /** Válido pero sin boletas: el pago entró y la persona no tiene nada. Hay que aprobarlo. */
      return f.entrada_id
        ? { label: "Válido", cls: VERDE }
        : { label: "Válido · sin boletas", cls: AMBAR };
    case "aprobado_manual":
      return { label: f.entrada_id ? "Aprobado a mano" : "Aprobado · faltan datos", cls: VERDE };
    case "rechazado_manual":
      return { label: "Rechazado", cls: ROJO };
    case "pendiente":
      return { label: "Procesando", cls: GRIS };
    case "revision_manual":
      return { label: "En revisión", cls: AMBAR };
    case "ocr_error":
      return { label: "No se pudo leer", cls: AMBAR };
    case "monto_incoherente":
      return { label: "Monto no coincide", cls: AMBAR };
    case "datos_bancarios_incoherentes":
      return { label: "Cuenta de destino no coincide", cls: AMBAR };
    case "duplicado_hash":
    case "duplicado_ocr":
      return { label: "Comprobante repetido", cls: AMBAR };
    case "comprobante_reenviado":
      return { label: "Mensaje reenviado", cls: AMBAR };
    case "comprobante_vencido":
      return { label: "Fecha vieja", cls: AMBAR };
    default:
      return { label: f.estado_validacion ?? "—", cls: GRIS };
  }
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleString("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describirAprobacion(res: ManualSorteoApprovalResult): { ok: boolean; texto: string } {
  if (!res.ok) return { ok: false, texto: res.message };
  const partes: string[] = [];
  if (res.mode === "order_closed") {
    partes.push(
      res.reused ? `Ya tenía la orden N.º ${res.numeroOrden}.` : `Compra cerrada: orden N.º ${res.numeroOrden}.`,
      `${res.cuponesCount} boleta(s). Se le mandaron por WhatsApp.`
    );
    if (res.ticketWarning) partes.push(`Boleta: ${res.ticketWarning}`);
  } else if (res.mode === "pending_participant_data") {
    partes.push(
      "Comprobante aprobado. Faltan datos de la persona: el bot se los va a pedir por WhatsApp y ahí se generan las boletas."
    );
    if (res.missingFields?.length) partes.push(`Falta: ${res.missingFields.join(", ")}.`);
  } else {
    partes.push("Comprobante aprobado. La persona tiene que confirmar en el chat para que se generen las boletas.");
  }
  if (res.whatsappWarning) partes.push(`WhatsApp: ${res.whatsappWarning}`);
  return { ok: true, texto: partes.join(" ") };
}

export default function ComprobantesPage() {
  const [q, setQ] = useState("");
  const [qAplicada, setQAplicada] = useState("");
  const [estado, setEstado] = useState<EstadoFiltroComprobantes>("pendientes");
  const [preset, setPreset] = useState("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filas, setFilas] = useState<FilaComprobanteCompra[]>([]);
  const [resumen, setResumen] = useState<ResumenBusqueda | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aprobar, setAprobar] = useState<FilaComprobanteCompra | null>(null);
  const [rechazar, setRechazar] = useState<FilaComprobanteCompra | null>(null);

  const hoy = ymdEnParaguay(new Date());
  const rango = preset === "todo" ? null : rangoFechaChat(preset, desde, hasta);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ estado });
      if (qAplicada.trim()) sp.set("q", qAplicada.trim());
      if (preset !== "todo") sp.set("fecha", preset);
      if (preset === "rango") {
        if (desde) sp.set("desde", desde);
        if (hasta) sp.set("hasta", hasta);
      }
      const res = await fetchWithSupabaseSession(`/api/sorteos/comprobantes?${sp.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { filas: FilaComprobanteCompra[]; resumen: ResumenBusqueda; truncado: boolean };
      };
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || `No se pudo cargar (${res.status})`);
      setFilas(json.data.filas);
      setResumen(json.data.resumen);
      setTruncado(json.data.truncado);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setFilas([]);
      setResumen(null);
    } finally {
      setCargando(false);
    }
  }, [estado, qAplicada, preset, desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const buscar = () => {
    const texto = q.trim();
    setQAplicada(texto);
    /** Quien busca a alguien quiere ver todo lo suyo, no solo lo pendiente. */
    if (texto && estado === "pendientes") setEstado("todos");
  };

  const nombrePersona = qAplicada
    ? filas.find((f) => f.nombre)?.nombre ?? null
    : null;

  return (
    <div className="max-w-7xl space-y-6">
      <nav className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/sorteos" className="font-medium text-slate-500 transition-colors hover:text-[#4FAEB2]">
          Sorteos
        </Link>
        <span aria-hidden className="text-slate-300">/</span>
        <span className="font-semibold text-slate-700">Comprobantes</span>
      </nav>

      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
          />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Sorteos · Comprobantes</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Comprobantes y compras</h1>
        <p className="mt-1 text-sm text-slate-500">
          Revisá a mano los comprobantes que el bot no pudo validar, o buscá a una persona para ver todo lo que pagó y
          las boletas de cada pago.
        </p>
      </div>

      {/* Filtros */}
      <div className="space-y-3 rounded-2xl border border-[#4FAEB2]/45 bg-white p-5 shadow-sm">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Teléfono, CI, nombre, N.º de boleta u orden"
            className="min-w-[14rem] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
            aria-label="Buscar persona"
          />
          <button
            type="submit"
            className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
          >
            Buscar
          </button>
          {qAplicada ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setQAplicada("");
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Limpiar
            </button>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-slate-100/80 p-0.5" role="group" aria-label="Estado">
            {ESTADOS_TAB.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={estado === t.id}
                onClick={() => setEstado(t.id)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  estado === t.id ? "bg-[#4FAEB2] text-white shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-slate-100/80 p-0.5" role="group" aria-label="Fecha">
            {[{ id: "todo", label: "Todo" }, ...PRESETS_FECHA_CHAT, { id: "rango", label: "Rango" }].map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={preset === o.id}
                onClick={() => {
                  setPreset(o.id);
                  if (o.id === "rango") {
                    setDesde((d) => d || hoy);
                    setHasta((h) => h || hoy);
                  }
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  preset === o.id ? "bg-[#4FAEB2] text-white shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {preset === "rango" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <label className="flex items-center gap-1">
                Desde
                <input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
              </label>
              <label className="flex items-center gap-1">
                Hasta
                <input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
              </label>
            </div>
          ) : null}
        </div>
        {rango ? <p className="text-xs text-slate-500">Fecha del comprobante: {describirRangoFechaChat(rango, preset)}</p> : null}
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {aviso ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            aviso.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {aviso.texto}
        </div>
      ) : null}

      {/* Resumen de la persona buscada */}
      {qAplicada && resumen && !cargando ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Búsqueda</p>
            <p className="text-sm font-semibold text-slate-900">{nombrePersona ?? qAplicada}</p>
          </div>
          <Dato label="Comprobantes" valor={String(resumen.comprobantes)} />
          <Dato label="Compras" valor={String(resumen.compras)} />
          <Dato label="Boletas" valor={String(resumen.boletas)} />
          <Dato label="Total comprado" valor={gs(resumen.monto_compras)} />
          {resumen.pendientes > 0 ? (
            <Dato label="Sin revisar" valor={String(resumen.pendientes)} alerta />
          ) : null}
        </div>
      ) : null}

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl border border-[#4FAEB2]/45 bg-white shadow-sm">
        {cargando ? (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
            Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-400">
            {qAplicada
              ? "No hay comprobantes ni compras para esa búsqueda."
              : estado === "pendientes"
                ? "No hay comprobantes esperando revisión."
                : "Sin comprobantes en ese período."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Persona</th>
                  <th className="px-4 py-3">Monto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Boletas</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((f) => {
                  const chip = estadoDeFila(f);
                  const pendiente = esComprobantePendiente(f);
                  const puedeRechazar = f.tipo === "comprobante" && f.estado_validacion !== "rechazado_manual";
                  return (
                    <tr key={`${f.tipo}-${f.id}`} className="align-top transition-colors hover:bg-[#4FAEB2]/5">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{fecha(f.fecha)}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{f.nombre ?? "—"}</div>
                        <div className="text-xs text-slate-500">
                          {[f.documento ? `CI ${f.documento}` : null, f.telefono].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {f.tipo === "comprobante" ? (
                          <>
                            <div className="font-mono text-sm text-slate-800">{gs(f.monto_comprobante)}</div>
                            {f.monto_esperado != null && f.monto_esperado !== f.monto_comprobante ? (
                              <div className="text-[11px] text-amber-700">Esperado {gs(f.monto_esperado)}</div>
                            ) : null}
                            {f.referencia ? <div className="text-[11px] text-slate-400">Ref. {f.referencia}</div> : null}
                          </>
                        ) : (
                          <div className="font-mono text-sm text-slate-800">{gs(f.monto_compra)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${chip.cls}`}>
                          {chip.label}
                        </span>
                        {f.aprobacion_manual_nota ? (
                          <div className="mt-1 max-w-[14rem] text-[11px] leading-snug text-slate-500">{f.aprobacion_manual_nota}</div>
                        ) : null}
                        {f.sorteo_nombre ? <div className="mt-1 text-[11px] text-slate-400">{f.sorteo_nombre}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        {f.boletas.length > 0 ? (
                          <>
                            <div className="text-[11px] text-slate-500">
                              {f.numero_orden ? `Orden N.º ${f.numero_orden} · ` : ""}
                              {f.boletas.length} boleta(s)
                              {f.monto_compra != null && f.tipo === "comprobante" ? ` · ${gs(f.monto_compra)}` : ""}
                            </div>
                            <div className="mt-1 flex max-w-[18rem] flex-wrap gap-1">
                              {f.boletas.map((b) => (
                                <span key={b} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                                  {b}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">{pendiente ? "Sin boletas todavía" : "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {f.comprobante_url ? (
                            <a
                              href={f.comprobante_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/8 px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/12"
                            >
                              Ver comprobante
                            </a>
                          ) : null}
                          {f.conversation_id ? (
                            <Link
                              href={`/dashboard/conversaciones?conversationId=${encodeURIComponent(f.conversation_id)}`}
                              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Chat
                            </Link>
                          ) : null}
                          {pendiente ? (
                            <button
                              type="button"
                              disabled={ocupado === f.id}
                              onClick={() => setAprobar(f)}
                              className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              Aprobar
                            </button>
                          ) : null}
                          {puedeRechazar ? (
                            <button
                              type="button"
                              disabled={ocupado === f.id}
                              onClick={() => setRechazar(f)}
                              className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              Rechazar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {truncado ? (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Se muestran los más recientes. Buscá a la persona o elegí un período para ver el resto.
          </p>
        ) : null}
      </div>

      {aprobar ? (
        <DialogoAprobar
          fila={aprobar}
          onCancelar={() => setAprobar(null)}
          onConfirmar={async () => {
            const f = aprobar;
            setAprobar(null);
            if (!f.validacion_id) return;
            setOcupado(f.id);
            setAviso(null);
            try {
              setAviso(describirAprobacion(await approveComprobanteValidacion(f.validacion_id)));
              await cargar();
            } catch (e) {
              setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo aprobar." });
            } finally {
              setOcupado(null);
            }
          }}
        />
      ) : null}

      {rechazar ? (
        <DialogoRechazarComprobante
          nombre={rechazar.nombre}
          monto={rechazar.monto_comprobante}
          numeroOrden={rechazar.entrada_id ? rechazar.numero_orden ?? "" : null}
          boletas={rechazar.boletas.length}
          onCancelar={() => setRechazar(null)}
          onConfirmar={async (motivo, avisar, mensaje) => {
            const f = rechazar;
            setRechazar(null);
            if (!f.validacion_id) return;
            setOcupado(f.id);
            setAviso(null);
            try {
              const r = await rejectComprobanteValidacion({
                validacionId: f.validacion_id,
                motivo,
                avisarCliente: avisar,
                mensaje,
              });
              if (!r.ok) setAviso({ ok: false, texto: r.message });
              else {
                const partes = ["Comprobante rechazado."];
                if (r.ordenRechazada) partes.push(`La orden N.º ${f.numero_orden ?? ""} quedó anulada.`);
                if (avisar) partes.push(r.avisado ? "Se le avisó por WhatsApp." : `No se le pudo avisar: ${r.avisoError ?? "error"}.`);
                setAviso({ ok: true, texto: partes.join(" ") });
              }
              await cargar();
            } catch (e) {
              setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo rechazar." });
            } finally {
              setOcupado(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function Dato({ label, valor, alerta }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`font-mono text-sm font-semibold ${alerta ? "text-amber-700" : "text-slate-900"}`}>{valor}</p>
    </div>
  );
}

function Modal({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DialogoAprobar(props: { fila: FilaComprobanteCompra; onCancelar: () => void; onConfirmar: () => void }) {
  const f = props.fila;
  return (
    <Modal onCerrar={props.onCancelar}>
      <p className="text-sm font-semibold text-slate-900">Aprobar comprobante</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">
        {f.nombre ?? "La persona"} · {gs(f.monto_comprobante)}. Se cierra la compra, se generan las boletas y se le
        mandan por WhatsApp. Si le faltan datos (nombre, CI), el bot se los pide primero.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={props.onCancelar} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          Cancelar
        </button>
        <button
          type="button"
          onClick={props.onConfirmar}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Aprobar y generar boletas
        </button>
      </div>
    </Modal>
  );
}
