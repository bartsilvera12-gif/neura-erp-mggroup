"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import TicketTermico from "@/components/sorteos/TicketTermico";
import {
  CONFIG_TICKET_DEFECTO,
  type ConfigTicket,
  type DatosTicket,
} from "@/lib/sorteos/ticket-impresion-tipos";

const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#4FAEB2]";

/** Venta inventada para la vista previa; nunca se guarda ni se imprime como real. */
const EJEMPLO: DatosTicket = {
  entrada_id: "preview",
  numero_orden: 128,
  fecha: new Date().toISOString(),
  cliente: "Jazmín Quintana",
  documento: "5754288",
  telefono: "0984511496",
  cantidad: 2,
  monto: 20000,
  pago_metodo: "efectivo",
  cupones: ["4827", "7154"],
  sorteo_nombre: "Nissan Frontier",
  vendedor_nombre: "Carlos Benítez",
  vendedor_numero: 3,
};

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export default function ConfigTicketPage() {
  const [cfg, setCfg] = useState<ConfigTicket>(CONFIG_TICKET_DEFECTO);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/sorteos/ticket-impresion/config", {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          data?: { cfg: ConfigTicket };
        };
        if (!cancelado && json.success && json.data) setCfg(json.data.cfg);
      } catch {
        /* se queda con los valores por defecto */
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function guardar() {
    setGuardando(true);
    setErr(null);
    setAviso(null);
    try {
      const res = await fetchWithSupabaseSession("/api/sorteos/ticket-impresion/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { cfg: ConfigTicket };
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "No se pudo guardar.");
      }
      setCfg(json.data.cfg);
      setAviso("Configuración guardada.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const set = <K extends keyof ConfigTicket>(k: K, v: ConfigTicket[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:py-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Impresora / Ticket</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cómo sale impreso el ticket que entrega el vendedor.
        </p>
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

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <Campo label="Ancho del papel">
              <div className="flex gap-2">
                {([58, 80] as const).map((mm) => (
                  <button
                    key={mm}
                    type="button"
                    onClick={() => set("ancho_mm", mm)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                      cfg.ancho_mm === mm
                        ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {mm} mm
                  </button>
                ))}
              </div>
            </Campo>

            <Campo label="Nombre del negocio">
              <input
                className={INPUT}
                value={cfg.negocio_nombre}
                onChange={(e) => set("negocio_nombre", e.target.value)}
                placeholder="MG GROUP"
              />
            </Campo>

            <Campo label="Logo (URL de imagen)">
              <input
                className={INPUT}
                value={cfg.logo_url}
                onChange={(e) => set("logo_url", e.target.value)}
                placeholder="https://..."
              />
            </Campo>

            <Campo label="Texto de encabezado">
              <textarea
                className={`${INPUT} min-h-[60px]`}
                value={cfg.encabezado}
                onChange={(e) => set("encabezado", e.target.value)}
                placeholder="Sorteo autorizado · RUC ..."
              />
            </Campo>

            <Campo label="Texto de pie">
              <textarea
                className={`${INPUT} min-h-[60px]`}
                value={cfg.pie}
                onChange={(e) => set("pie", e.target.value)}
                placeholder="¡Gracias por tu compra!"
              />
            </Campo>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={cfg.mostrar_telefono}
                  onChange={(e) => set("mostrar_telefono", e.target.checked)}
                />
                Mostrar teléfono del cliente
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={cfg.mostrar_vendedor}
                  onChange={(e) => set("mostrar_vendedor", e.target.checked)}
                />
                Mostrar número de vendedor
              </label>
            </div>

            <Campo label="Copias por impresión">
              <select
                className={INPUT}
                value={cfg.copias}
                onChange={(e) => set("copias", Number(e.target.value))}
              >
                <option value={1}>1 copia</option>
                <option value={2}>2 copias</option>
                <option value={3}>3 copias</option>
              </select>
            </Campo>

            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando}
              className="w-full rounded-xl bg-[#1e2a5a] py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
              Vista previa
            </h2>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mx-auto bg-white p-2 shadow-sm" style={{ width: "fit-content" }}>
                <TicketTermico cfg={cfg} datos={EJEMPLO} />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Datos de ejemplo. El ancho real lo define la impresora; acá se ve la proporción y
              qué campos salen.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
