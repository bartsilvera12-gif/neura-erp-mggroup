import { listarComprasPendientes } from "@/lib/chat/compras-pendientes-actions";

export const dynamic = "force-dynamic";

const OPCIONES_DIAS = [1, 7, 15, 30];

export default async function ComprasPendientesPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const sp = await searchParams;
  const dias = OPCIONES_DIAS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const filas = await listarComprasPendientes(dias);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Compras sin finalizar</h1>
        <p className="text-sm text-slate-500">
          Contactos que cargaron sus datos por WhatsApp pero no confirmaron la compra: sin boleta generada.
          Son oportunidades para volver a contactar.
        </p>
      </div>

      <div className="flex gap-2 text-sm">
        {OPCIONES_DIAS.map((d) => (
          <a
            key={d}
            href={`/dashboard/compras-pendientes?dias=${d}`}
            className={`px-3 py-1 rounded border ${
              d === dias ? "bg-slate-800 text-white border-slate-800" : "border-slate-300"
            }`}
          >
            {d === 1 ? "Último día" : `Últimos ${d} días`}
          </a>
        ))}
      </div>

      <p className="text-sm text-slate-600">{filas.length} contactos con compra sin finalizar</p>

      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-2">Nombre</th>
              <th className="p-2">Cédula</th>
              <th className="p-2">Ciudad</th>
              <th className="p-2">Teléfono</th>
              <th className="p-2">Compra</th>
              <th className="p-2">Último movimiento</th>
              <th className="p-2">Estado</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-slate-500">
                  No hay compras sin finalizar en este período.
                </td>
              </tr>
            )}
            {filas.map((f) => {
              const digitos = f.telefono.replace(/\D/g, "");
              return (
                <tr key={f.conversation_id} className="border-t">
                  <td className="p-2">{f.nombre}</td>
                  <td className="p-2">{f.cedula}</td>
                  <td className="p-2">{f.ciudad}</td>
                  <td className="p-2">{f.telefono}</td>
                  <td className="p-2">{f.opcion}</td>
                  <td className="p-2">
                    {new Date(f.ultimo_movimiento).toLocaleString("es-PY", { timeZone: "America/Asuncion" })}
                  </td>
                  <td className="p-2">Datos cargados, sin boleta</td>
                  <td className="p-2">
                    {digitos && (
                      <a
                        href={`https://wa.me/${digitos}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 underline"
                      >
                        Contactar
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
