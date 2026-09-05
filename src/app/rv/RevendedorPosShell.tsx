"use client";

import { useState } from "react";
import RevendedorPinGate from "./RevendedorPinGate";
import RevendedorPosClient from "./RevendedorPosClient";

type PosProps = React.ComponentProps<typeof RevendedorPosClient>;

/**
 * Decide si mostrar la pantalla de PIN o el POS.
 *
 * El estado inicial lo calcula el servidor (`debePedirPin`): así, con la cookie de desbloqueo
 * ya puesta, el vendedor no ve un parpadeo del PIN antes de entrar. Después del desbloqueo se
 * cambia en el cliente y no hace falta recargar.
 */
export default function RevendedorPosShell({
  debePedirPin,
  vendedorNombre,
  numeroVendedor,
  pos,
}: {
  debePedirPin: boolean;
  vendedorNombre: string;
  numeroVendedor: number | null;
  pos: PosProps;
}) {
  const [bloqueado, setBloqueado] = useState(debePedirPin);

  if (bloqueado) {
    return (
      <RevendedorPinGate
        vendedorNombre={vendedorNombre}
        numeroVendedor={numeroVendedor}
        onDesbloqueado={() => setBloqueado(false)}
      />
    );
  }
  return <RevendedorPosClient {...pos} />;
}
