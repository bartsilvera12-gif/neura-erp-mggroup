import { redirect } from "next/navigation";
import { readRevendedorSession, getRevendedorSaldo } from "@/lib/sorteos/revendedor-session";
import RevendedorPosClient from "./RevendedorPosClient";

export const dynamic = "force-dynamic";

export default async function RevendedorPosPage() {
  const ctx = await readRevendedorSession();
  if (!ctx) redirect("/rv/invalido");

  const saldo = await getRevendedorSaldo(ctx);

  return (
    <RevendedorPosClient
      revendedorNombre={ctx.nombre}
      sorteoNombre={ctx.sorteo.nombre}
      precioPorBoleto={ctx.sorteo.precioPorBoleto}
      sorteoActivo={ctx.sorteo.estado === "activo"}
      cupoBoletos={ctx.cupoBoletos}
      boletosVendidos={saldo.boletosVendidos}
      cupoRestante={saldo.cupoRestante}
      saldoARendir={saldo.saldoARendir}
    />
  );
}
