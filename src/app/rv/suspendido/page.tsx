export const dynamic = "force-dynamic";

/** El vendedor abre su link y el servicio está cortado por falta de pago. */
export default function RevendedorServicioSuspendidoPage() {
  return (
    <div className="min-h-svh flex items-center justify-center bg-slate-900 p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="text-4xl">⛔</div>
        <h1 className="text-xl font-bold text-white">Servicio suspendido</h1>
        <p className="text-sm text-slate-300">
          El sistema está suspendido por falta de pago, así que el punto de venta no está
          disponible. Hablá con el administrador del sorteo.
        </p>
        <p className="text-sm text-slate-400">
          Cuando se regularice el pago, todo se reactiva automáticamente.
        </p>
      </div>
    </div>
  );
}
