"use client";

import { useMemo, useState } from "react";

type Props = {
  revendedorNombre: string;
  /** Correlativo por empresa; el vendedor lo necesita para el modo venta por WhatsApp. */
  numeroVendedor?: number | null;
  sorteoNombre: string;
  precioPorBoleto: number;
  sorteoActivo: boolean;
  cupoBoletos: number | null;
  boletosVendidos: number;
  cupoRestante: number | null;
  saldoARendir: number;
};

type SaleResult = {
  /** Id de la venta registrada: con esto se abre e imprime su ticket. */
  entrada_id?: string;
  numero_orden: number;
  cupones: { id: string; numero_cupon: string }[];
  monto_total: number;
  cantidad: number;
  pago_metodo: string;
  estado_pago: string;
  sorteo_nombre: string;
  revendedor_nombre: string;
};

/**
 * La venta va por pasos: boletos → cliente → pago.
 *
 * Antes era un formulario único y había que completarlo entero antes de saber cuánto cobrar.
 * Partida en pasos, lo primero que queda fijo es la cantidad con su total —que es lo que el
 * comprador pregunta— y recién después se cargan sus datos.
 */
type Paso = "boletos" | "cliente" | "pago";

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

/** Atajos de cantidad: cubren casi todas las ventas sin abrir el teclado numérico. */
const CANTIDADES_RAPIDAS = [1, 2, 3, 5, 10];

export default function RevendedorPosClient(props: Props) {
  const [paso, setPaso] = useState<Paso>("boletos");
  const [documento, setDocumento] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [cantidad, setCantidad] = useState<string>("1");
  const [pagoMetodo, setPagoMetodo] = useState<"efectivo" | "transferencia">("efectivo");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);
  /**
   * Clave de la venta que se esta cargando, no del envio.
   *
   * Se generaba nueva en cada envio, con lo cual la idempotencia no protegia de nada: dos
   * clicks en «Confirmar», o volver atras y confirmar de nuevo, entraban como dos claves
   * distintas y el servidor las tomaba como dos ventas distintas, con dos numeros de boleto y
   * cobrandole dos veces al mismo comprador.
   *
   * Atada a la venta, reintentar manda la MISMA clave: el servidor reconoce que ya la registro
   * y devuelve la que existe, con sus mismos cupones. Se renueva recien en «Nueva venta», que
   * es cuando de verdad empieza otra.
   */
  const [idemKey, setIdemKey] = useState<string>(newIdemKey);

  /**
   * Autocompleta nombre, teléfono y ciudad desde una compra anterior con ese documento.
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
        data?: { encontrado?: boolean; nombre?: string; telefono?: string; ciudad?: string };
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || "No se pudo buscar.");
      }
      if (!json.data?.encontrado) {
        setAvisoBusqueda("Sin compras anteriores con ese documento. Cargá los datos a mano.");
        return;
      }
      const habiaAlgoEscrito = Boolean(nombre.trim() || telefono.trim() || ciudad.trim());
      const n = (json.data.nombre ?? "").trim();
      const t = (json.data.telefono ?? "").trim();
      const c = (json.data.ciudad ?? "").trim();
      if (n && !nombre.trim()) setNombre(n);
      if (t && !telefono.trim()) setTelefono(t);
      if (c && !ciudad.trim()) setCiudad(c);
      setAvisoBusqueda(
        habiaAlgoEscrito
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

  function reservar() {
    setErr(null);
    if (!props.sorteoActivo) return setErr("El sorteo no está activo.");
    if (qty < 1) return setErr("La cantidad debe ser mayor a 0.");
    setPaso("cliente");
  }

  function irAlPago() {
    setErr(null);
    if (!nombre.trim()) return setErr("Ingresá el nombre del comprador.");
    if (!telefono.trim()) return setErr("Ingresá el teléfono.");
    setPaso("pago");
  }

  async function confirmar() {
    setErr(null);
    if (!props.sorteoActivo) {
      setErr("El sorteo no está activo.");
      return;
    }
    if (!nombre.trim() || !telefono.trim() || qty < 1) {
      setErr("Faltan datos de la venta.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/sorteos/revendedor-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documento: documento.trim(),
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          ciudad: ciudad.trim(),
          cantidad: qty,
          pago_metodo: pagoMetodo,
          idempotency_key: idemKey,
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
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Error al registrar la venta.");
    } finally {
      setSubmitting(false);
    }
  }

  function nuevaVenta() {
    setResult(null);
    setPaso("boletos");
    setDocumento("");
    setNombre("");
    setTelefono("");
    setCiudad("");
    setCantidad("1");
    setPagoMetodo("efectivo");
    setErr(null);
    setAvisoBusqueda(null);
    /** Recien aca empieza otra venta: hasta este punto, reintentar tiene que dar la misma. */
    setIdemKey(newIdemKey());
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
            {ciudad ? <Row k="Ciudad" v={ciudad} /> : null}
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

        <div className="w-full max-w-[380px] mt-4 space-y-2 print:hidden">
          {/*
            Lleva a la pantalla de impresión, que arma el ticket con el formato y el ancho de
            papel configurados. Es la misma pantalla que se usa para reimprimir: siempre lee la
            venta ya registrada, así que nunca genera otro número.
          */}
          {result.entrada_id ? (
            <a
              href={`/ticket/${result.entrada_id}`}
              className="block w-full rounded-xl bg-[#1e2a5a] py-4 text-center text-lg font-bold text-white"
            >
              🖨 IMPRIMIR TICKET
            </a>
          ) : null}
          <div className="flex gap-2">
          <button
            type="button"
            onClick={nuevaVenta}
            className="flex-1 bg-white border border-slate-300 text-slate-800 rounded-xl py-3 font-semibold"
          >
            Nueva venta
          </button>
          </div>
        </div>

        <style>{`@media print { body { background: #fff !important; } .print\\:hidden { display: none !important; } #rv-recibo { box-shadow: none !important; } }`}</style>
      </div>
    );
  }

  // ---- Venta en tres pasos ----
  return (
    <div className="min-h-svh bg-slate-100 flex flex-col">
      <header className="bg-slate-900 text-white px-5 py-4">
        <div className="text-sm font-semibold uppercase tracking-wide opacity-70">{props.sorteoNombre}</div>
        <div className="text-lg font-extrabold">Punto de venta</div>
        {/*
          El número va acá para que el vendedor lo tenga siempre a mano: es lo que le piden al
          escribir #VENTA por WhatsApp, y antes dependía de que se lo recordara el administrador.
        */}
        <div className="text-[11px] opacity-70 mt-0.5">
          {props.numeroVendedor != null ? `Vendedor N.º ${props.numeroVendedor} · ` : "Vendedor: "}
          {props.revendedorNombre}
        </div>
      </header>

      <PasosBarra paso={paso} />

      <div className="flex-1 px-4 pb-6 space-y-3">
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

        {paso === "boletos" && (
          <>
            <div className="bg-white rounded-2xl shadow-sm p-3 text-center">
              <div className="text-[10px] uppercase text-slate-400">Precio por boleto</div>
              <div className="text-sm font-bold text-slate-800">{gs(props.precioPorBoleto)}</div>
            </div>

            <Field label="¿Cuántos boletos?">
              <div className="mb-2 grid grid-cols-5 gap-2">
                {CANTIDADES_RAPIDAS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setCantidad(String(n))}
                    className={`rounded-xl py-3 text-base font-bold border ${
                      qty === n
                        ? "bg-[#4FAEB2] text-white border-[#4FAEB2]"
                        : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <input
                inputMode="numeric"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-lg font-bold outline-none focus:border-[#4FAEB2]"
              />
            </Field>

            <TotalCard total={total} />

            <button
              type="button"
              onClick={reservar}
              disabled={!props.sorteoActivo}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl py-4 font-bold text-base"
            >
              RESERVAR {qty > 0 ? `${qty} BOLETO${qty === 1 ? "" : "S"}` : ""}
            </button>
          </>
        )}

        {paso === "cliente" && (
          <>
            <ResumenBoletos qty={qty} total={total} onEditar={() => setPaso("boletos")} />

            <Field label="Documento (C.I. / RUC)">
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  /** Buscar con Enter, sin enviar la venta a medio completar. */
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
              {avisoBusqueda && <p className="mt-1 text-[11px] text-slate-500">{avisoBusqueda}</p>}
            </Field>

            <Field label="Nombre y Apellido">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
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

            <Field label="Ciudad">
              <input
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#4FAEB2]"
              />
            </Field>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaso("boletos")}
                className="rounded-xl border border-slate-300 bg-white px-5 py-4 font-semibold text-slate-700"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={irAlPago}
                className="flex-1 rounded-xl bg-slate-900 py-4 text-base font-bold text-white hover:bg-slate-800"
              >
                CONTINUAR AL PAGO
              </button>
            </div>
          </>
        )}

        {paso === "pago" && (
          <>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-400">Resumen</div>
              <div className="space-y-1 text-sm text-slate-800">
                <Row k="Comprador" v={nombre || "—"} />
                {documento ? <Row k="Documento" v={documento} /> : null}
                <Row k="Teléfono" v={telefono || "—"} />
                {ciudad ? <Row k="Ciudad" v={ciudad} /> : null}
                <Row k="Boletos" v={`${qty}`} />
              </div>
            </div>

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

            <TotalCard total={total} />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaso("cliente")}
                disabled={submitting}
                className="rounded-xl border border-slate-300 bg-white px-5 py-4 font-semibold text-slate-700 disabled:opacity-50"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={submitting || !props.sorteoActivo}
                className="flex-1 rounded-xl bg-slate-900 py-4 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? "Registrando…" : "CONFIRMAR E IMPRIMIR"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Dónde está parada la venta. Tres pasos entran cómodos hasta en la pantalla más angosta. */
function PasosBarra({ paso }: { paso: Paso }) {
  const pasos: { id: Paso; n: number; label: string }[] = [
    { id: "boletos", n: 1, label: "Boletos" },
    { id: "cliente", n: 2, label: "Cliente" },
    { id: "pago", n: 3, label: "Pago" },
  ];
  const actual = pasos.find((p) => p.id === paso)?.n ?? 1;
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {pasos.map((p) => {
        const hecho = p.n < actual;
        const activo = p.n === actual;
        return (
          <div key={p.id} className="flex flex-1 items-center gap-1.5">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                activo
                  ? "bg-slate-900 text-white"
                  : hecho
                    ? "bg-[#4FAEB2] text-white"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {hecho ? "✓" : p.n}
            </span>
            <span
              className={`truncate text-[11px] font-semibold ${
                activo ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Los boletos ya elegidos, con su total, mientras se cargan los datos del comprador.
 *
 * Los números todavía no salen de la base: se asignan al confirmar la venta, en la misma
 * transacción que el correlativo. Sacarlos antes dejaría numeración quemada cada vez que una
 * venta se abandona a mitad de camino, y eso no se puede deshacer.
 */
function ResumenBoletos({
  qty,
  total,
  onEditar,
}: {
  qty: number;
  total: number;
  onEditar: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#1e2a5a] px-4 py-3 text-white">
      <div>
        <div className="text-[10px] uppercase opacity-70">Reservado</div>
        <div className="text-sm font-bold">
          {qty} boleto{qty === 1 ? "" : "s"} · {gs(total)}
        </div>
      </div>
      <button
        type="button"
        onClick={onEditar}
        className="rounded-lg border border-white/40 px-3 py-1.5 text-xs font-semibold"
      >
        Cambiar
      </button>
    </div>
  );
}

function TotalCard({ total }: { total: number }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
      <span className="text-sm font-semibold text-slate-600">TOTAL</span>
      <span className="text-2xl font-extrabold text-slate-900">{gs(total)}</span>
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
