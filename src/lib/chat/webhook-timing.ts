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
  /** Detalle por consulta (que tabla y que operacion), para el desglose de los ciclos lentos. */
  detallar: (etiqueta: string, ms: number) => void;
  activa: () => boolean;
};

let impl: MedicionImpl | null = null;

export function registrarImplementacionDeMedicion(i: MedicionImpl): void {
  impl = i;
}

/**
 * ¿Estamos dentro del procesamiento de un webhook entrante?
 *
 * El contexto activo lo abre `medirWebhook`, así que existe solo mientras se atiende un
 * mensaje del bot. Se usa además de para medir, para decidir el transporte de base: el camino
 * directo a Postgres tiene un pool chico y se reserva para el bot, de modo que la bandeja o el
 * CRM no puedan quitarle conexiones justo cuando un cliente está comprando.
 */
export function enProcesamientoDeWebhook(): boolean {
  return impl?.activa() ?? false;
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
 * Igual que `medirEtapa("db", …)`, anotando ademas que consulta fue.
 *
 * El reparto por etapas dice que el 80 % del ciclo se va en la base, pero no cuales de las
 * ~130 consultas son. Sin eso, agrupar o paralelizar es adivinar cual conviene tocar.
 */
export async function medirConsulta<T>(etiqueta: string, fn: () => Promise<T>): Promise<T> {
  if (!impl?.activa()) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    impl.acumular("db", ms);
    impl.detallar(etiqueta, ms);
  }
}

/** `tabla:operacion` a partir del SQL, para agrupar el detalle. Best-effort: es solo para el log. */
export function etiquetaDeSql(sql: string): string {
  const s = sql.trim().replace(/\s+/g, " ");
  const op = /^(select|insert|update|delete|with)/i.exec(s)?.[1]?.toLowerCase() ?? "otro";
  const tabla =
    /(?:from|into|update|join)\s+"?([a-z0-9_]+)"?\."?([a-z0-9_]+)"?/i.exec(s)?.[2] ??
    /(?:from|into|update|join)\s+"?([a-z0-9_]+)"?/i.exec(s)?.[1] ??
    "?";
  return `${tabla}:${op}`;
}

/** `recurso:metodo` a partir de una URL de PostgREST (`/rest/v1/<tabla>?…`). */
export function etiquetaDeUrlPostgrest(url: string, metodo: string): string {
  const m = /\/rest\/v1\/(?:rpc\/)?([a-z0-9_]+)/i.exec(url);
  const esRpc = /\/rest\/v1\/rpc\//i.test(url);
  const recurso = m?.[1] ?? (/\/storage\/v1\//i.test(url) ? "storage" : "?");
  return `${esRpc ? "rpc." : ""}${recurso}:${metodo.toLowerCase()}`;
}

/**
 * `fetch` que le suma su duracion a la etapa `db`. Se le pasa a los clientes Supabase del
 * webhook para medir todo PostgREST sin tocar las consultas una por una.
 */
export const fetchMedido: typeof fetch = (...args) => {
  const [entrada, init] = args;
  const url =
    typeof entrada === "string"
      ? entrada
      : entrada instanceof URL
        ? entrada.href
        : (entrada as Request).url;
  const metodo = init?.method ?? (entrada as Request)?.method ?? "GET";
  return medirConsulta(etiquetaDeUrlPostgrest(url, metodo), () => fetch(...args));
};
