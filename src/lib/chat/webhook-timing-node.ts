/**
 * Implementacion de servidor del reparto de tiempos del webhook. Ver `webhook-timing`.
 *
 * Vive aparte porque importa `node:async_hooks`: solo puede importarlo codigo que nunca
 * termina en el bundle del navegador (el manejador del webhook).
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { registrarImplementacionDeMedicion } from "@/lib/chat/webhook-timing";

type Acumulador = {
  /** ms acumulados y cantidad de llamadas, por etapa. */
  etapas: Map<string, { ms: number; n: number }>;
  inicio: number;
};

const almacen = new AsyncLocalStorage<Acumulador>();

registrarImplementacionDeMedicion({
  activa: () => almacen.getStore() != null,
  acumular: (etapa, ms) => {
    const acc = almacen.getStore();
    if (!acc) return;
    const prev = acc.etapas.get(etapa) ?? { ms: 0, n: 0 };
    acc.etapas.set(etapa, { ms: prev.ms + ms, n: prev.n + 1 });
  },
});

export type ResumenWebhook = Record<string, number>;

/**
 * Corre el manejador del webhook midiendo, y devuelve el resumen junto al resultado.
 * `resto_ms` es todo lo no instrumentado: logica, serializacion y esperas sin medir.
 */
export async function medirWebhook<T>(
  fn: () => Promise<T>
): Promise<{ resultado: T; resumen: ResumenWebhook }> {
  const acc: Acumulador = { etapas: new Map(), inicio: Date.now() };
  const resultado = await almacen.run(acc, fn);

  const total = Date.now() - acc.inicio;
  const resumen: ResumenWebhook = { total_ms: total };
  let medido = 0;
  for (const [etapa, v] of acc.etapas) {
    resumen[`${etapa}_ms`] = v.ms;
    resumen[`${etapa}_n`] = v.n;
    medido += v.ms;
  }
  resumen.resto_ms = Math.max(0, total - medido);
  return { resultado, resumen };
}

/**
 * Milisegundos desde que arranco este proceso.
 *
 * Separa arranque en frio de procesamiento: si al atender el webhook el proceso tiene pocos
 * cientos de ms de vida, la instancia se acaba de crear y buena parte de la espera que ve el
 * cliente es el arranque, no el codigo.
 */
export function msDesdeArranqueDelProceso(): number {
  return process.uptime() * 1000;
}
