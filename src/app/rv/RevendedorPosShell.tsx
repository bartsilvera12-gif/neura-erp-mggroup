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
  volverTrasDesbloquear,
  pos,
}: {
  debePedirPin: boolean;
  vendedorNombre: string;
  numeroVendedor: number | null;
  /**
   * Pantalla a la que volver apenas se desbloquea, cuando el vendedor llegó acá desde otra
   * —hoy, el ticket que estaba por imprimir—. Ya viene validada del servidor.
   */
  volverTrasDesbloquear?: string | null;
  pos: PosProps;
}) {
  const [bloqueado, setBloqueado] = useState(debePedirPin);

  if (bloqueado) {
    return (
      <RevendedorPinGate
        vendedorNombre={vendedorNombre}
        numeroVendedor={numeroVendedor}
        onDesbloqueado={() => {
          /**
           * Vuelve al ticket en vez de dejarlo en el POS: el vendedor venía de imprimir, y
           * dejarlo en la pantalla de venta es justamente lo que hacía parecer que imprimir
           * no funcionaba. `location` y no el router del cliente, para que la página del
           * ticket se monte de cero y vuelva a pedir los datos ya con el PIN puesto.
           */
          if (volverTrasDesbloquear) {
            window.location.href = volverTrasDesbloquear;
            return;
          }
          setBloqueado(false);
        }}
      />
    );
  }
  return <RevendedorPosClient {...pos} />;
}
