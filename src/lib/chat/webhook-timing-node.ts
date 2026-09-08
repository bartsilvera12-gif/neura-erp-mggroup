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
  /** Lo mismo, pero por consulta concreta (`tabla:operacion`). */
  detalle: Map<string, { ms: number; n: number }>;
  inicio: number;
};

const almacen = new AsyncLocalStorage<Acumulador>();

function sumar(mapa: Map<string, { ms: number; n: number }>, clave: string, ms: number): void {
  const prev = mapa.get(clave) ?? { ms: 0, n: 0 };
  mapa.set(clave, { ms: prev.ms + ms, n: prev.n + 1 });
}

registrarImplementacionDeMedicion({
  activa: () => almacen.getStore() != null,
  acumular: (etapa, ms) => {
    const acc = almacen.getStore();
    if (acc) sumar(acc.etapas, etapa, ms);
  },
  detallar: (etiqueta, ms) => {
    const acc = almacen.getStore();
    if (acc) sumar(acc.detalle, etiqueta, ms);
  },
});

export type ResumenWebhook = Record<string, number>;

/**
 * Corre el manejador del webhook midiendo, y devuelve el resumen junto al resultado.
 * `resto_ms` es todo lo no instrumentado: logica, serializacion y esperas sin medir.
 */
export async function medirWebhook<T>(
  fn: () => Promise<T>
): Promise<{ resultado: T; resumen: ResumenWebhook; detalle: DetalleConsulta[] }> {
  const acc: Acumulador = { etapas: new Map(), detalle: new Map(), inicio: Date.now() };
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

  const detalle = [...acc.detalle.entries()]
    .map(([consulta, v]) => ({ consulta, ms: v.ms, n: v.n }))
    .sort((a, b) => b.ms - a.ms);

  return { resultado, resumen, detalle };
}

/** Una consulta (o familia de consultas) del ciclo, con lo que costo en total. */
export type DetalleConsulta = { consulta: string; ms: number; n: number };

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
