import SorteosListClient from "./SorteosListClient";
import { getSorteosVentasKpis } from "@/lib/sorteos/ventas-kpis";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { getCurrentUserRolServer } from "@/lib/auth/get-current-user-rol-server";

/** KPIs dependen de sesión y ventana calendario Paraguay; evitar cache estático de respuestas en 0. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SorteosPage() {
  let ventasKpis = {
    boletosHoy: 0,
    boletosMes: 0,
    montoHoy: 0,
    montoMes: 0,
  };
  try {
    ventasKpis = await getSorteosVentasKpis();
  } catch {
    /* sin sesión o error de red: KPIs en cero */
  }
  /**
   * Los acumulados del mes son solo para administración: el supervisor ve el pulso del día,
   * no el negocio del mes. Sin rol resuelto se ocultan, que es el lado seguro.
   */
  const mostrarAcumuladosDelMes = esRolAdminEmpresaOGlobal(await getCurrentUserRolServer());
  return (
    <SorteosListClient ventasKpis={ventasKpis} mostrarAcumuladosDelMes={mostrarAcumuladosDelMes} />
  );
}
