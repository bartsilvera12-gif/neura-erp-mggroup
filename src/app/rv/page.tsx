import { redirect } from "next/navigation";
import { readRevendedorSession, getRevendedorSaldo } from "@/lib/sorteos/revendedor-session";
import { posDesbloqueado } from "@/lib/sorteos/revendedor-pin-session";
import RevendedorPosShell from "./RevendedorPosShell";

export const dynamic = "force-dynamic";

export default async function RevendedorPosPage() {
  const ctx = await readRevendedorSession();
  if (!ctx) redirect("/rv/invalido");

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
      vendedorNombre={ctx.nombre}
      numeroVendedor={ctx.numeroVendedor}
      pos={{
        revendedorNombre: ctx.nombre,
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
