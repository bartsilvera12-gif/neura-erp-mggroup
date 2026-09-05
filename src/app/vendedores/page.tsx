"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Vendedor = {
  id: string;
  numero_vendedor: number | null;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  activo: boolean;
  tiene_pin: boolean;
  tiene_link: boolean;
  cupo_boletos: number | null;
};

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithSupabaseSession(url, init);
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || !json.success || json.data === undefined) {
    throw new Error(json.error || "Error en la operación.");
  }
  return json.data;
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#4FAEB2]";

export default function VendedoresPage() {
  const [rows, setRows] = useState<Vendedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cupo, setCupo] = useState("");
  const [pin, setPin] = useState("");

  /** PIN recién generado. Se muestra una vez y no se puede volver a consultar. */
  const [pinNuevo, setPinNuevo] = useState<{ nombre: string; pin: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const d = await pedir<{ vendedores: Vendedor[] }>("/api/vendedores", { cache: "no-store" });
      setRows(d.vendedores);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setErr("Poné el nombre del vendedor.");
    setGuardando(true);
    setErr(null);
    try {
      const d = await pedir<{ vendedor: Vendedor; pin: string }>("/api/vendedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          cargo: cargo.trim() || null,
          telefono: telefono.trim() || null,
          cupo_boletos: cupo.trim() || null,
          ...(pin.trim() ? { pin: pin.trim() } : {}),
        }),
      });
      setPinNuevo({ nombre: d.vendedor.nombre, pin: d.pin });
      setNombre("");
      setCargo("");
      setTelefono("");
      setCupo("");
      setPin("");
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarEstado(v: Vendedor) {
    setErr(null);
    try {
      await pedir(`/api/vendedores/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !v.activo }),
      });
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cambiar el estado.");
    }
  }

  async function regenerarPin(v: Vendedor) {
    if (!window.confirm(`¿Generar un PIN nuevo para ${v.nombre}? El anterior deja de servir.`)) {
      return;
    }
    setErr(null);
    try {
      const d = await pedir<{ pin: string }>(`/api/vendedores/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerar_pin: true }),
      });
      setPinNuevo({ nombre: v.nombre, pin: d.pin });
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo generar el PIN.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:py-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Vendedores</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alta y gestión. El número de vendedor se asigna solo y no cambia.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      {pinNuevo && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            PIN de {pinNuevo.nombre}
          </p>
          <p className="my-1 text-3xl font-bold tracking-[0.2em] tabular-nums text-amber-900">
            {pinNuevo.pin}
          </p>
          <p className="text-xs text-amber-800">
            Anotalo y pasáselo ahora. No se guarda en claro: no vas a poder volver a verlo, solo
            generar uno nuevo.
          </p>
          <button
            type="button"
            onClick={() => setPinNuevo(null)}
            className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900"
          >
            Ya lo anoté
          </button>
        </div>
      )}

      <form
        onSubmit={crear}
        className="space-y-3 rounded-xl border border-[#4FAEB2]/45 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Nuevo vendedor
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Nombre">
            <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo label="Cargo (opcional)">
            <input
              className={INPUT}
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              placeholder="Ej: Vendedor de calle"
            />
          </Campo>
          <Campo label="Teléfono (opcional)">
            <input
              className={INPUT}
              inputMode="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="Ej: 0981..."
            />
          </Campo>
          <Campo label="Cupo de boletas (opcional)">
            <input
              className={INPUT}
              inputMode="numeric"
              value={cupo}
              onChange={(e) => setCupo(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Sin límite"
            />
          </Campo>
          <Campo label="PIN (dejalo vacío y se genera solo)">
            <input
              className={INPUT}
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
              placeholder="4 a 8 dígitos"
            />
          </Campo>
        </div>
        <button
          type="submit"
          disabled={guardando}
          className="rounded-xl bg-[#1e2a5a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {guardando ? "Creando…" : "Crear vendedor"}
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Listado</h2>
        {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
        {!cargando && rows.length === 0 && (
          <p className="text-sm text-slate-500">Todavía no hay vendedores.</p>
        )}
        <ul className="space-y-2">
          {rows.map((v) => (
            <li
              key={v.id}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-700">
                      N.º {v.numero_vendedor ?? "—"}
                    </span>
                    <span className="truncate font-medium text-slate-900">{v.nombre}</span>
                    {!v.activo && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                        inactivo
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    {v.cargo && <span>{v.cargo}</span>}
                    {v.telefono && <span>{v.telefono}</span>}
                    <span>{v.cupo_boletos == null ? "Sin cupo" : `Cupo ${v.cupo_boletos}`}</span>
                    <span className={v.tiene_pin ? "text-emerald-700" : "text-amber-700"}>
                      {v.tiene_pin ? "con PIN" : "sin PIN"}
                    </span>
                    <span className={v.tiene_link ? "text-emerald-700" : "text-slate-400"}>
                      {v.tiene_link ? "con link" : "sin link"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/vendedores/${v.id}`}
                  className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-2.5 py-1.5 text-xs font-medium text-[#3F8E91]"
                >
                  Cierre de caja
                </Link>
                <button
                  type="button"
                  onClick={() => void alternarEstado(v)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {v.activo ? "Desactivar" : "Activar"}
                </button>
                <button
                  type="button"
                  onClick={() => void regenerarPin(v)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Nuevo PIN
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] leading-relaxed text-slate-500">
        El link de acceso al POS de cada vendedor se genera desde{" "}
        <Link href="/sorteos" className="text-[#4FAEB2] hover:underline">
          Sorteos
        </Link>{" "}
        → el sorteo → Revendedores.
      </p>
    </div>
  );
}
