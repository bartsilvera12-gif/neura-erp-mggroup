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
  /** El error del PIN es el único con salida propia: mandarlo a cargarlo y traerlo de vuelta. */
  const [pidePin, setPidePin] = useState(false);
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
          /** 401 con sesión de vendedor válida = falta el desbloqueo por PIN. */
          if (!cancelado && res.status === 401 && /pin/i.test(json.error ?? "")) {
            setPidePin(true);
          }
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

  /**
   * Una hoja por número comprado.
   *
   * Antes los tres números de una compra salían juntos en la misma hoja, y así no se pueden
   * repartir: cada boleto es lo que una persona guarda o regala. Con varios números se imprime
   * un ticket por número, y el importe de cada hoja es el de un boleto, no el de la compra
   * entera —tres hojas diciendo 30.000 cada una se leen como si hubiera pagado 90.000.
   *
   * Las copias configuradas se aplican sobre cada número: 3 números × 2 copias = 6 hojas.
   */
  const numeros = datos?.cupones ?? [];
  const variosBoletos = numeros.length > 1;
  const montoPorBoleto = variosBoletos
    ? Math.round((datos?.monto ?? 0) / numeros.length)
    : (datos?.monto ?? 0);
  const hojas: { copia: { n: number; de: number }; boleto?: { n: number; de: number; numero: string; monto: number } }[] = [];
  if (datos) {
    if (variosBoletos) {
      numeros.forEach((numero, i) => {
        for (let c = 0; c < copias; c++) {
          hojas.push({
            copia: { n: c + 1, de: copias },
            boleto: { n: i + 1, de: numeros.length, numero, monto: montoPorBoleto },
          });
        }
      });
    } else {
      for (let c = 0; c < copias; c++) {
        hojas.push({ copia: { n: c + 1, de: copias } });
      }
    }
  }

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

      {/*
        Con error no se dibujaba ningún botón: ni imprimir ni volver. El vendedor quedaba en una
        pantalla muerta con un cartel, salía con el botón del navegador y lo único que le
        aparecía era «Nueva venta», como si imprimir no existiera.

        El caso frecuente es el PIN: el POS lo pide cada 12 h y esta pantalla no tenía dónde
        cargarlo, así que la única salida era abandonar el ticket. Ahora lleva a cargarlo y
        vuelve acá solo.
      */}
      {err && (
        <div className="no-imprimir mx-auto max-w-[360px] space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </div>
          {pidePin ? (
            <a
              href={`/rv?volver=${encodeURIComponent(`/ticket/${id}`)}`}
              className="block w-full rounded-xl bg-[#1e2a5a] py-4 text-center text-lg font-bold text-white"
            >
              Ingresar mi PIN
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => window.history.back()}
            className="w-full rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-800"
          >
            ← Volver
          </button>
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
            <button
              type="button"
              onClick={() => window.history.back()}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-800"
            >
              ← Volver
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Papel {cfg.ancho_mm} mm · {hojas.length === 1 ? "1 hoja" : `${hojas.length} hojas`}
              {variosBoletos ? " (una por número)" : ""}
              {copias > 1 ? ` · ${copias} copias` : ""}. Reimprimir no genera otra venta ni otro
              número.
            </p>
          </div>

          {hojas.map((hoja, i) => (
            <div key={i} className="hoja-ticket mb-4 bg-white p-2">
              <TicketTermico cfg={cfg} datos={datos} copia={hoja.copia} boleto={hoja.boleto} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
