"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import TicketTermico from "@/components/sorteos/TicketTermico";
import {
  CONFIG_TICKET_DEFECTO,
  type ConfigTicket,
  type DatosTicket,
} from "@/lib/sorteos/ticket-impresion-tipos";

/**
 * Pantalla de impresión del ticket. Sirve igual para imprimir recién hecha la venta y para
 * reimprimir después: en los dos casos lee la venta ya registrada, así que el ticket sale
 * idéntico y nunca genera una venta ni un número nuevo.
 */
export default function TicketPage() {
  const params = useParams();
  const id = String(params?.entradaId ?? "");
  const [cfg, setCfg] = useState<ConfigTicket>(CONFIG_TICKET_DEFECTO);
  const [datos, setDatos] = useState<DatosTicket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/sorteos/ticket-impresion/${id}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          data?: { cfg: ConfigTicket; datos: DatosTicket };
          error?: string;
        };
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || "No se pudo cargar el ticket.");
        }
        if (!cancelado) {
          setCfg(json.data.cfg);
          setDatos(json.data.datos);
        }
      } catch (e) {
        if (!cancelado) setErr(e instanceof Error ? e.message : "No se pudo cargar el ticket.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [id]);

  const copias = Math.max(1, cfg.copias);

  return (
    <div className="min-h-svh bg-slate-100 py-4">
      {/*
        `size: <ancho>mm auto` es lo que hace que la térmica corte al largo del contenido en
        vez de tirar una hoja entera. Al imprimir se oculta todo menos el ticket.
      */}
      <style>{`
        @page { size: ${cfg.ancho_mm}mm auto; margin: 3mm; }
        @media print {
          html, body { background: #fff !important; margin: 0; padding: 0; }
          .no-imprimir { display: none !important; }
          .hoja-ticket { break-after: page; page-break-after: always; }
          .hoja-ticket:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      {cargando && <p className="no-imprimir px-4 text-center text-sm text-slate-500">Cargando…</p>}

      {err && (
        <div className="no-imprimir mx-auto max-w-[360px] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      {datos && (
        <>
          <div className="no-imprimir mx-auto mb-4 max-w-[360px] px-4">
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full rounded-xl bg-[#1e2a5a] py-4 text-lg font-bold text-white"
            >
              🖨 IMPRIMIR TICKET
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Papel {cfg.ancho_mm} mm · {copias === 1 ? "1 copia" : `${copias} copias`}. Reimprimir
              no genera otra venta ni otro número.
            </p>
          </div>

          {Array.from({ length: copias }, (_, i) => (
            <div key={i} className="hoja-ticket mb-4 bg-white p-2">
              <TicketTermico
                cfg={cfg}
                datos={datos}
                copia={{ n: i + 1, de: copias }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
