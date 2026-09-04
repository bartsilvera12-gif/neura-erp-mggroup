"use client";

import { useMemo, useState } from "react";

type Props = {
  revendedorNombre: string;
  sorteoNombre: string;
  precioPorBoleto: number;
  sorteoActivo: boolean;
  cupoBoletos: number | null;
  boletosVendidos: number;
  cupoRestante: number | null;
  saldoARendir: number;
};

type SaleResult = {
  numero_orden: number;
  cupones: { id: string; numero_cupon: string }[];
  monto_total: number;
  cantidad: number;
  pago_metodo: string;
  estado_pago: string;
  sorteo_nombre: string;
  revendedor_nombre: string;
};

const PYG = new Intl.NumberFormat("es-PY");
function gs(n: number): string {
  return "₲ " + PYG.format(Math.round(n || 0));
}

function newIdemKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "rv-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

export default function RevendedorPosClient(props: Props) {
  const [documento, setDocumento] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cantidad, setCantidad] = useState<string>("1");
  const [pagoMetodo, setPagoMetodo] = useState<"efectivo" | "transferencia">("efectivo");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [restante, setRestante] = useState<number | null>(props.cupoRestante);
  const [saldo, setSaldo] = useState<number>(props.saldoARendir);
  const [buscando, setBuscando] = useState(false);
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);

  /**
   * Autocompleta nombre y teléfono desde una compra anterior de este documento en el sorteo.
   * Nunca pisa lo que el vendedor ya escribió: si corrigió un dato a mano, ese gana.
   */
  async function buscarCliente() {
    const doc = documento.trim();
    setAvisoBusqueda(null);
    if (doc.replace(/[^0-9A-Za-z]/g, "").length < 4) {
      setAvisoBusqueda("Escribí el documento completo para buscar.");
      return;
    }
    setBuscando(true);
    try {
      const res = await fetch(
        `/api/sorteos/revendedor-cliente?documento=${encodeURIComponent(doc)}`
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { encontrado?: boolean; nombre?: string; telefono?: string };
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || "No se pudo buscar.");
      }
      if (!json.data?.encontrado) {
        setAvisoBusqueda("Sin compras anteriores con ese documento. Cargá los datos a mano.");
        return;
      }
      const n = (json.data.nombre ?? "").trim();
      const t = (json.data.telefono ?? "").trim();
      if (n && !nombre.trim()) setNombre(n);
      if (t && !telefono.trim()) setTelefono(t);
      setAvisoBusqueda(
        nombre.trim() || telefono.trim()
          ? "Comprador encontrado. Se completaron solo los campos vacíos."
          : "Comprador encontrado."
      );
    } catch (ex) {
      setAvisoBusqueda(ex instanceof Error ? ex.message : "No se pudo buscar.");
    } finally {
      setBuscando(false);
    }
  }

  const qty = useMemo(() => {
    const n = parseInt(cantidad, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [cantidad]);
  const total = qty * props.precioPorBoleto;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!props.sorteoActivo) {
      setErr("El sorteo no está activo.");
      return;
    }
    if (!nombre.trim()) return setErr("Ingresá el nombre del comprador.");
    if (!telefono.trim()) return setErr("Ingresá el teléfono.");
    if (qty < 1) return setErr("La cantidad debe ser mayor a 0.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/sorteos/revendedor-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documento: documento.trim(),
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          cantidad: qty,
          pago_metodo: pagoMetodo,
          idempotency_key: newIdemKey(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: SaleResult;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "No se pudo registrar la venta.");
      }
      setResult(json.data);
      if (props.cupoBoletos != null) {
        setRestante((r) => (r == null ? null : Math.max(0, r - json.data!.cantidad)));
      }
      if (pagoMetodo === "efectivo") setSaldo((s) => s + (json.data!.monto_total || 0));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Error al registrar la venta.");
    } finally {
      setSubmitting(false);
    }
  }

  function nuevaVenta() {
    setResult(null);
    setDocumento("");
    setNombre("");
    setTelefono("");
    setCantidad("1");
    setPagoMetodo("efectivo");
    setErr(null);
    setAvisoBusqueda(null);
  }

  // ---- Vista de comprobante (post-venta, imprimible) ----
  if (result) {
    return (
      <div className="min-h-svh bg-slate-100 flex flex-col items-center py-6 px-4">
        <div id="rv-recibo" className="w-full max-w-[380px] bg-white rounded-2xl shadow p-5 text-slate-900">
          <div className="text-center border-b border-dashed border-slate-300 pb-3">
            <div className="text-lg font-extrabold uppercase tracking-wide">{result.sorteo_nombre}</div>
            <div className="text-[11px] text-slate-500">Vendedor: {result.revendedor_nombre}</div>
          </div>
          <div className="py-3 space-y-1 text-sm">
            <Row k="N° de orden" v={`#${result.numero_orden}`} />
            <Row k="Comprador" v={nombre || "—"} />
            {documento ? <Row k="Documento" v={documento} /> : null}
            <Row k="Teléfono" v={telefono || "—"} />
            <Row k="Cantidad" v={`${result.cantidad} boleto(s)`} />
            <Row k="Forma de pago" v={result.pago_metodo === "efectivo" ? "Efectivo" : "Transferencia"} />
            <Row k="Estado" v={result.estado_pago === "confirmado" ? "Confirmado" : "Pendiente"} />
          </div>
          <div className="border-t border-dashed border-slate-300 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-1">Números / cupones</div>
            <div className="flex flex-wrap gap-1.5">
              {result.cupones.map((c) => (
                <span key={c.id} className="text-xs font-mono font-bold bg-slate-900 text-white rounded px-2 py-1">
                  {c.numero_cupon}
                </span>
              ))}
            </div>
          </div>
          <div className="border-t border-dashed border-slate-300 mt-3 pt-3 flex items-center justify-between">
            <span className="text-sm font-semibold">TOTAL</span>
            <span className="text-xl font-extrabold text-emerald-600">{gs(result.monto_total)}</span>
          </div>
          <p className="text-center text-[10px] text-slate-400 mt-3">¡Gracias por participar! 🍀</p>
        </div>

        <div className="w-full max-w-[380px] mt-4 flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3 font-semibold"
          >
            🖨️ Imprimir
          </button>
          <button
            type="button"
            onClick={nuevaVenta}
            className="flex-1 bg-white border border-slate-300 text-slate-800 rounded-xl py-3 font-semibold"
          >
            Nueva venta
          </button>
        </div>

        <style>{`@media print { body { background: #fff !important; } .print\\:hidden { display: none !important; } #rv-recibo { box-shadow: none !important; } }`}</style>
      </div>
    );
  }

  // ---- Formulario de venta ----
  return (
    <div className="min-h-svh bg-slate-100 flex flex-col">
      <header className="bg-slate-900 text-white px-5 py-4">
        <div className="text-sm font-semibold uppercase tracking-wide opacity-70">{props.sorteoNombre}</div>
        <div className="text-lg font-extrabold">Punto de venta</div>
        <div className="text-[11px] opacity-70 mt-0.5">Vendedor: {props.revendedorNombre}</div>
      </header>

      <div className="px-4 -mt-3">
        <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center justify-around text-center">
          <div>
            <div className="text-[10px] uppercase text-slate-400">Cupo restante</div>
            <div className="text-sm font-bold text-slate-800">
              {restante == null ? "Ilimitado" : restante}
            </div>
          </div>
          <div className="w-px h-8 bg-slate-100" />
          <div>
            <div className="text-[10px] uppercase text-slate-400">A rendir</div>
            <div className="text-sm font-bold text-slate-800">{gs(saldo)}</div>
          </div>
          <div className="w-px h-8 bg-slate-100" />
          <div>
            <div className="text-[10px] uppercase text-slate-400">Precio</div>
            <div className="text-sm font-bold text-slate-800">{gs(props.precioPorBoleto)}</div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 px-4 pt-4 pb-6 space-y-3">
        {!props.sorteoActivo && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-3 py-2">
            El sorteo no está activo. No se pueden registrar ventas.
          </div>
        )}
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-3 py-2" role="alert">
            {err}
          </div>
        )}

        <Field label="Documento (C.I. / RUC)">
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              /** Buscar con Enter sin enviar la venta a medio completar. */
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void buscarCliente();
                }
              }}
              placeholder="Opcional"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#4FAEB2]"
            />
            <button
              type="button"
              onClick={() => void buscarCliente()}
              disabled={buscando}
              title="Buscar comprador por documento"
              aria-label="Buscar comprador por documento"
              className="shrink-0 rounded-xl bg-[#1e2a5a] px-4 text-white disabled:opacity-50"
            >
              {buscando ? "…" : "🔍"}
            </button>
          </div>
          {avisoBusqueda && (
            <p className="mt-1 text-[11px] text-slate-500">{avisoBusqueda}</p>
          )}
        </Field>
        <Field label="Nombre y Apellido">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Juan Pérez"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#4FAEB2]"
          />
        </Field>
        <Field label="Teléfono">
          <input
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Ej: 0981..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#4FAEB2]"
          />
        </Field>
        <Field label={`Cantidad × ${gs(props.precioPorBoleto)}`}>
          <input
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#4FAEB2]"
          />
        </Field>
        <Field label="Forma de pago">
          <div className="grid grid-cols-2 gap-2">
            {(["efectivo", "transferencia"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setPagoMetodo(m)}
                className={`rounded-xl py-3 text-sm font-semibold border ${
                  pagoMetodo === m
                    ? "bg-[#4FAEB2] text-white border-[#4FAEB2]"
                    : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {m === "efectivo" ? "Efectivo" : "Transferencia"}
              </button>
            ))}
          </div>
          {pagoMetodo === "transferencia" ? (
            <p className="text-[11px] text-slate-500 mt-1">
              La venta queda pendiente de revisión del comprobante.
            </p>
          ) : null}
        </Field>

        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">TOTAL</span>
          <span className="text-2xl font-extrabold text-slate-900">{gs(total)}</span>
        </div>

        <button
          type="submit"
          disabled={submitting || !props.sorteoActivo}
          className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl py-4 font-bold text-base"
        >
          {submitting ? "Registrando…" : "CONFIRMAR E IMPRIMIR"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}
