/**
 * Reparto del tiempo de un webhook entrante de WhatsApp (parte neutra).
 *
 * El mensaje de bienvenida tarda 10-15 s y los logs decian *que* pasaba pero no *cuanto*
 * tardaba cada parte. Sin ese reparto, optimizar es adivinar: la demora puede estar en el
 * arranque en frio, en la distancia a la base (decenas de consultas secuenciales) o en la
 * llamada a Meta, y cada causa se arregla distinto.
 *
 * Este archivo NO importa nada de Node. Lo alcanzan modulos que terminan en el bundle del
 * navegador (via server actions), y un `import` de `node:async_hooks` aca rompe el build.
 * La implementacion real vive en `webhook-timing-node`, que se registra al cargarse en el
 * servidor. Sin registrar, todo esto es no-op.
 */

export type MedicionImpl = {
  /** Acumulador activo, o null si no hay medicion en curso. */
  acumular: (etapa: string, ms: number) => void;
  activa: () => boolean;
};

let impl: MedicionImpl | null = null;

export function registrarImplementacionDeMedicion(i: MedicionImpl): void {
  impl = i;
}

/** Envuelve una operacion y le suma su duracion a `etapa`. No-op si no hay medicion activa. */
export async function medirEtapa<T>(etapa: string, fn: () => Promise<T>): Promise<T> {
  if (!impl?.activa()) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    impl.acumular(etapa, Date.now() - t0);
  }
}

/**
 * `fetch` que le suma su duracion a la etapa `db`. Se le pasa a los clientes Supabase del
 * webhook para medir todo PostgREST sin tocar las consultas una por una.
 */
export const fetchMedido: typeof fetch = (...args) => medirEtapa("db", () => fetch(...args));
