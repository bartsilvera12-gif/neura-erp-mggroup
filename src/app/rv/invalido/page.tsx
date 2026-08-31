export const dynamic = "force-dynamic";

export default function RevendedorLinkInvalidoPage() {
  return (
    <div className="min-h-svh flex items-center justify-center bg-slate-900 p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="text-4xl">🔒</div>
        <h1 className="text-xl font-bold text-white">Link no válido</h1>
        <p className="text-sm text-slate-300">
          Este link de vendedor no es válido, expiró o fue revocado. Pedí un link nuevo al
          administrador del sorteo.
        </p>
      </div>
    </div>
  );
}
