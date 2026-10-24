import type { ResumenImpresionCupones } from "@/lib/sorteos/tandas-impresas-pg";

/**
 * «¿Hasta dónde imprimimos?», contestado en la pantalla.
 *
 * Cada fila es una tanda: cuándo se imprimió, cuántas boletas salieron y entre qué números de
 * orden. Arriba, lo que falta. Antes esto solo se podía averiguar consultando la base.
 */
export default function TandasImpresasPanel({
  resumen,
  sorteoId,
}: {
  resumen: ResumenImpresionCupones;
  sorteoId: string;
}) {
  const { tandas, pendientes_boletas, pendientes_compras, impresas_boletas } = resumen;
  const fmt = (n: number) => n.toLocaleString("es-PY");

  /**
   * Imprimir lo que falta: confirmadas, sin imprimir, sin rango de números ni fechas. Es el
   * camino en el que cada compra sale completa y la tanda queda registrada sola al imprimir.
   */
  const urlLoQueFalta = `/sorteos/${encodeURIComponent(
    sorteoId
  )}/imprimir-cupones?estado=confirmado&solo_no_impresas=1`;

  const cuando = (iso: string) =>
    new Date(iso).toLocaleString("es-PY", {
      timeZone: "America/Asuncion",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="rounded-2xl border border-[#4FAEB2]/45 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="block h-5 w-1 rounded-full bg-[#4FAEB2]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          Qué se imprimió
        </h3>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Boletas impresas
          </p>
          <p className="font-mono text-lg font-semibold text-slate-900">{fmt(impresas_boletas)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Falta imprimir
          </p>
          <p
            className={`font-mono text-lg font-semibold ${
              pendientes_boletas > 0 ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {fmt(pendientes_boletas)}
          </p>
          <p className="text-[11px] text-slate-500">{fmt(pendientes_compras)} compras confirmadas</p>
        </div>
        {pendientes_boletas > 0 ? (
          <a
            href={urlLoQueFalta}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
          >
            Imprimir lo que falta ({fmt(pendientes_boletas)})
          </a>
        ) : null}
      </div>

      {tandas.length === 0 ? (
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Todavía no se marcó ninguna tanda como impresa. Al imprimir, el sistema registra acá hasta
          dónde llegaste, para que la próxima tanda siga desde ese punto.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Tanda</th>
                  <th className="py-2 pr-4">Boletas</th>
                  <th className="py-2 pr-4">Compras</th>
                  <th className="py-2">Órdenes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tandas.map((t) => (
                  <tr key={t.marcado_at}>
                    <td className="py-2 pr-4 whitespace-nowrap text-xs text-slate-600">
                      {cuando(t.marcado_at)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-sm text-slate-800">{fmt(t.boletas)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{fmt(t.compras)}</td>
                    <td className="py-2 font-mono text-xs text-slate-600">
                      {t.orden_desde != null && t.orden_hasta != null
                        ? `N.º ${fmt(t.orden_desde)} al ${fmt(t.orden_hasta)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Las órdenes de cada tanda no son correlativas: las hojas salen en orden de venta y una
            tanda puede abarcar órdenes salteadas. Lo que manda para seguir es «Solo no impresas».
          </p>
        </>
      )}
    </div>
  );
}
