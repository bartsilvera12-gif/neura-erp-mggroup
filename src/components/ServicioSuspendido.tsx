"use client";

import { MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI } from "@/lib/empresas/mensaje-bloqueo";

/**
 * Lo único que ve el cliente mientras el servicio está cortado por falta de pago.
 *
 * No es un cartel encima del ERP: reemplaza la aplicación entera. El corte real está en el
 * servidor, así que tampoco sirve de nada saltearse esta pantalla.
 */
export default function ServicioSuspendido({ mensaje }: { mensaje?: string | null }) {
  const texto = (mensaje ?? "").trim() || MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI;
  const parrafos = texto.split("\n").filter((l) => l.trim());
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-3xl">
            ⛔
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {parrafos[0] ?? "Servicio suspendido por falta de pago."}
          </h1>
        </div>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
          {parrafos.slice(1).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
