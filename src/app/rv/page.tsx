import { redirect } from "next/navigation";
import { readRevendedorSession, getRevendedorSaldo } from "@/lib/sorteos/revendedor-session";
import { posDesbloqueado } from "@/lib/sorteos/revendedor-pin-session";
import RevendedorPosShell from "./RevendedorPosShell";

export const dynamic = "force-dynamic";

/**
 * A dónde volver después de cargar el PIN.
 *
 * Solo se acepta la pantalla de impresión de un ticket, y con la forma exacta
 * `/ticket/<id>`: cualquier otra cosa se ignora. Un `volver` libre sería un redirector
 * abierto —basta pasarle otro destino en el link— y este link se comparte por WhatsApp.
 */
function volverSeguro(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^\/ticket\/[A-Za-z0-9-]{1,64}$/.test(v) ? v : null;
}

export default async function RevendedorPosPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const ctx = await readRevendedorSession();
  if (!ctx) redirect("/rv/invalido");

  const volver = volverSeguro((await searchParams).volver);

  /**
   * El estado del PIN se resuelve en el servidor para no mostrar el POS un instante antes de
   * bloquearlo. La validación real igual está en las rutas de venta y de búsqueda.
   */
  const debePedirPin =
    ctx.exigePin && !(await posDesbloqueado(ctx.revendedorId, ctx.pinActualizadoAt));

  const saldo = await getRevendedorSaldo(ctx);

  return (
    <RevendedorPosShell
      debePedirPin={debePedirPin}
      volverTrasDesbloquear={volver}
      vendedorNombre={ctx.nombre}
      numeroVendedor={ctx.numeroVendedor}
      pos={{
        revendedorNombre: ctx.nombre,
        numeroVendedor: ctx.numeroVendedor,
        sorteoNombre: ctx.sorteo.nombre,
        precioPorBoleto: ctx.sorteo.precioPorBoleto,
        sorteoActivo: ctx.sorteo.estado === "activo",
        cupoBoletos: ctx.cupoBoletos,
        boletosVendidos: saldo.boletosVendidos,
        cupoRestante: saldo.cupoRestante,
        saldoARendir: saldo.saldoARendir,
      }}
    />
  );
}
