"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type SorteoListItem = {
  id: string;
  nombre: string;
  estado?: string;
  ticket_delivery_mode?: string;
};

/** Estilo común de los campos: cómodo, redondeado y con foco teal, igual que el resto de la app. */
const FIELD_INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:bg-slate-50 disabled:text-slate-500";

/** Campo con etiqueta arriba. La etiqueta envuelve el control para que al tocarla se enfoque. */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {hint}
    </label>
  );
}

export default function SorteosCuponesManualClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sorteoFromUrl = searchParams?.get("sorteo_id")?.trim() ?? "";

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sorteos, setSorteos] = useState<SorteoListItem[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [form, setForm] = useState({
    sorteo_id: "",
    nombre: "",
    apellido: "",
    cedula: "",
    telefono: "",
    ciudad: "",
    cantidad_boletos: "1",
    monto_total: "",
    observacion_interna: "",
    generar_ticket_png: true,
  });
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);

  /**
   * Autocompleta los datos del comprador desde una compra anterior, buscándolo por cédula o por
   * celular y en cualquier edición. Completa solo los campos vacíos: nunca pisa lo que ya se
   * escribió. Se dispara al salir del campo cédula o teléfono, así el operador no tiene que
   * acordarse de ningún botón. `silencioso` evita avisos cuando todavía no hay dato suficiente.
   */
  const buscarCliente = useCallback(
    async (cedulaVal: string, telefonoVal: string, silencioso = true) => {
      const ced = cedulaVal.trim();
      const tel = telefonoVal.trim();
      const cedOk = ced.replace(/[^0-9A-Za-z]/g, "").length >= 4;
      const telOk = tel.replace(/\D/g, "").length >= 8;
      setAvisoBusqueda(null);
      if (!cedOk && !telOk) return;
      setBuscando(true);
      try {
        const params = new URLSearchParams();
        if (cedOk) params.set("documento", ced);
        if (telOk) params.set("telefono", tel);
        const res = await fetchWithSupabaseSession(
          `/api/sorteos/cliente-lookup?${params.toString()}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          data?: {
            encontrado?: boolean;
            nombre?: string;
            documento?: string;
            telefono?: string;
            ciudad?: string;
          };
          error?: string;
        };
        if (!res.ok || !json.success) return;
        if (!json.data?.encontrado) {
          if (!silencioso) setAvisoBusqueda("Sin compras anteriores con esos datos.");
          return;
        }
        const full = (json.data.nombre ?? "").trim();
        const [first, ...rest] = full.split(/\s+/).filter(Boolean);
        const nombreVal = first ?? "";
        const apellidoVal = rest.join(" ");
        const doc = (json.data.documento ?? "").trim();
        const t = (json.data.telefono ?? "").trim();
        const c = (json.data.ciudad ?? "").trim();
        setForm((p) => ({
          ...p,
          nombre: p.nombre.trim() ? p.nombre : nombreVal,
          apellido: p.apellido.trim() ? p.apellido : apellidoVal,
          cedula: p.cedula.trim() ? p.cedula : doc,
          telefono: p.telefono.trim() ? p.telefono : t,
          ciudad: p.ciudad.trim() ? p.ciudad : c,
        }));
        setAvisoBusqueda("Comprador encontrado. Se completaron los campos vacíos.");
      } catch {
        /* La búsqueda es una ayuda; si falla, el operador carga a mano. */
      } finally {
        setBuscando(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(crypto.randomUUID());
    setSubmitErr(null);
    setSubmitOk(null);
    setAvisoBusqueda(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadErr(null);
      try {
        const res = await fetchWithSupabaseSession("/api/sorteos", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; data?: SorteoListItem[] };
        if (!res.ok || !json.success || !Array.isArray(json.data)) {
          setLoadErr("No se pudieron cargar los sorteos.");
          return;
        }
        if (!cancelled) {
          const activos = json.data.filter((s) => (s.estado ?? "activo") === "activo");
          setSorteos(activos.length > 0 ? activos : json.data);
        }
      } catch {
        if (!cancelled) setLoadErr("Error de red al cargar sorteos.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || sorteos.length === 0) return;
    setForm((f) => {
      if (f.sorteo_id) return f;
      const pick =
        sorteoFromUrl && sorteos.some((s) => s.id === sorteoFromUrl)
          ? sorteoFromUrl
          : sorteos[0]?.id ?? "";
      return { ...f, sorteo_id: pick };
    });
  }, [open, sorteos, sorteoFromUrl]);

  const onField = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value, type } = e.target;
      if (type === "checkbox") {
        const c = e.target as HTMLInputElement;
        setForm((p) => ({ ...p, [name]: c.checked }));
        return;
      }
      setForm((p) => ({ ...p, [name]: value }));
    },
    []
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    setSubmitOk(null);

    const cantidad = Math.floor(Number(form.cantidad_boletos));
    const monto = Number(form.monto_total);
    if (!form.sorteo_id) {
      setSubmitErr("Elegí un sorteo.");
      return;
    }
    if (!form.nombre.trim() || !form.apellido.trim()) {
      setSubmitErr("Nombre y apellido son obligatorios.");
      return;
    }
    if (!form.telefono.trim()) {
      setSubmitErr("El teléfono es obligatorio.");
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      setSubmitErr("La cantidad de boletos debe ser mayor a 0.");
      return;
    }
    if (!Number.isFinite(monto) || monto < 0) {
      setSubmitErr("El monto total debe ser mayor o igual a 0.");
      return;
    }
    if (!idempotencyKey) {
      setSubmitErr("Falta clave de idempotencia; cerrá y volvé a abrir el formulario.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession("/api/sorteos/manual-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sorteo_id: form.sorteo_id,
          nombre: form.nombre.trim(),
          apellido: form.apellido.trim(),
          cedula: form.cedula.trim(),
          telefono: form.telefono.trim(),
          ciudad: form.ciudad.trim(),
          cantidad_boletos: cantidad,
          monto_total: monto,
          observacion_interna: form.observacion_interna.trim() || null,
          generar_ticket_png: form.generar_ticket_png,
          idempotency_key: idempotencyKey,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: {
          entrada_id?: string;
          numero_orden?: number;
          ticket?: { attempted?: boolean; delivery_ok?: boolean; skipped?: boolean; reason?: string };
        };
        error?: string;
      };
      if (!res.ok || !json.success) {
        setSubmitErr(json.error ?? "No se pudo registrar la venta.");
        return;
      }

      const num = json.data?.numero_orden ?? "—";
      let msg = `Orden Nº ${num} creada correctamente (pago confirmado).`;
      const t = json.data?.ticket;
      if (form.generar_ticket_png && t?.attempted) {
        if (t.delivery_ok && t.skipped && t.reason === "text_only") {
          msg += " Ticket PNG omitido: el sorteo está en modo solo texto.";
        } else if (t.delivery_ok === false) {
          msg += ` Advertencia: no se generó el ticket PNG (${t.reason ?? "error"}). La orden quedó registrada.`;
        } else if (t.skipped) {
          msg += ` Ticket: ${t.reason ?? "omitido"}.`;
        }
      }
      setSubmitOk(msg);
      /**
       * Clave nueva para la proxima venta.
       *
       * Se generaba solo al abrir el modal, y el modal queda abierto despues de guardar: la
       * segunda venta cargada sin cerrarlo mandaba la MISMA clave, el servidor la reconocia
       * como repetida y devolvia la primera. El aviso decia «orden creada» con el numero de la
       * anterior y la venta del segundo comprador no quedaba registrada.
       */
      setIdempotencyKey(crypto.randomUUID());
      setAvisoBusqueda(null);
      setForm((p) => ({
        ...p,
        nombre: "",
        apellido: "",
        cedula: "",
        telefono: "",
        ciudad: "",
        cantidad_boletos: "1",
        monto_total: "",
        observacion_interna: "",
      }));
      router.refresh();
    } catch {
      setSubmitErr("Error de red al guardar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 shadow-sm"
      >
        Crear cupón manual
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Venta presencial"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            {/* Header fijo */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Venta presencial</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Efectivo · se confirma el pago al guardar. No envía WhatsApp.
                </p>
              </div>
              <button
                type="button"
                className="-m-1.5 shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
              {/* Cuerpo scrolleable */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {loadErr ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {loadErr}
                  </div>
                ) : null}
                {submitErr ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    {submitErr}
                  </div>
                ) : null}
                {submitOk ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    {submitOk}
                  </div>
                ) : null}

                <Field label="Sorteo" required>
                  <div className="relative">
                    <select
                      name="sorteo_id"
                      value={form.sorteo_id}
                      onChange={onField}
                      required
                      className={`${FIELD_INPUT} cursor-pointer appearance-none pr-10`}
                    >
                      <option value="">— Elegir —</option>
                      {sorteos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre}
                          {(s.estado ?? "") !== "activo" ? ` (${s.estado})` : ""}
                        </option>
                      ))}
                    </select>
                    <svg
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </Field>

                {/* Sección: datos del comprador */}
                <div className="space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Comprador
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre" required>
                      <input
                        name="nombre"
                        value={form.nombre}
                        onChange={onField}
                        required
                        className={FIELD_INPUT}
                        autoComplete="given-name"
                      />
                    </Field>
                    <Field label="Apellido" required>
                      <input
                        name="apellido"
                        value={form.apellido}
                        onChange={onField}
                        required
                        className={FIELD_INPUT}
                        autoComplete="family-name"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Cédula">
                      <input
                        name="cedula"
                        value={form.cedula}
                        onChange={onField}
                        onBlur={() => void buscarCliente(form.cedula, form.telefono)}
                        className={`${FIELD_INPUT} font-mono`}
                      />
                    </Field>
                    <Field
                      label="Teléfono"
                      required
                      hint={
                        buscando ? (
                          <span className="block text-[11px] text-slate-400">Buscando comprador…</span>
                        ) : avisoBusqueda ? (
                          <span className="block text-[11px] font-medium text-emerald-600">
                            {avisoBusqueda}
                          </span>
                        ) : null
                      }
                    >
                      <input
                        name="telefono"
                        value={form.telefono}
                        onChange={onField}
                        onBlur={() => void buscarCliente(form.cedula, form.telefono)}
                        required
                        placeholder="0981 123 456"
                        className={`${FIELD_INPUT} font-mono`}
                        autoComplete="tel"
                        inputMode="tel"
                      />
                    </Field>
                  </div>
                  {/* Va impresa en el ticket y queda en la ficha del cliente. */}
                  <Field label="Ciudad">
                    <input
                      name="ciudad"
                      value={form.ciudad}
                      onChange={onField}
                      className={FIELD_INPUT}
                      autoComplete="address-level2"
                    />
                  </Field>
                </div>

                {/* Sección: datos de la venta */}
                <div className="space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Venta
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Cantidad de boletos" required>
                      <input
                        name="cantidad_boletos"
                        type="number"
                        min={1}
                        step={1}
                        value={form.cantidad_boletos}
                        onChange={onField}
                        required
                        className={FIELD_INPUT}
                      />
                    </Field>
                    <Field label="Monto total" required>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                          ₲
                        </span>
                        <input
                          name="monto_total"
                          type="number"
                          min={0}
                          step={1}
                          value={form.monto_total}
                          onChange={onField}
                          required
                          placeholder="0"
                          className={`${FIELD_INPUT} pl-8 tabular-nums`}
                        />
                      </div>
                    </Field>
                  </div>
                  <Field label="Método de pago">
                    <input value="Efectivo" readOnly disabled className={FIELD_INPUT} />
                  </Field>
                  <Field label="Observación interna (opcional)">
                    <textarea
                      name="observacion_interna"
                      value={form.observacion_interna}
                      onChange={onField}
                      rows={2}
                      className={`${FIELD_INPUT} resize-none`}
                    />
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3.5 py-2.5 text-slate-700 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      name="generar_ticket_png"
                      checked={form.generar_ticket_png}
                      onChange={onField}
                      className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
                    />
                    <span className="text-xs">
                      Generar ticket PNG (si el sorteo tiene imagen configurada)
                    </span>
                  </label>
                </div>
              </div>

              {/* Footer fijo */}
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3F8E91] disabled:opacity-60"
                >
                  {loading ? "Guardando…" : "Guardar venta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
