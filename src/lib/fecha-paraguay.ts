/**
 * Días calendario de Paraguay pasados a instantes UTC.
 *
 * El desfase no se escribe a mano: se lee del huso `America/Asuncion`. Paraguay pasó a UTC−3
 * fijo en octubre de 2024 y el código que tenía UTC−4 escrito cortaba los días una hora tarde;
 * leyéndolo del huso, sigue bien si el horario vuelve a cambiar.
 *
 * Sin dependencias de servidor: sirve en el navegador y en el servidor.
 */

const ZONA = "America/Asuncion";

/** Fecha calendario (AAAA-MM-DD) en Paraguay para un instante. */
export function ymdEnParaguay(instante: Date): string {
  return instante.toLocaleDateString("en-CA", { timeZone: ZONA });
}

/** Minutos que Paraguay está detrás de UTC en ese instante (180 con UTC−3). */
function desfaseMinutos(instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((instante.getTime() - comoUtc) / 60000);
}

/** Instante UTC en que empieza (00:00) ese día en Paraguay. */
export function inicioDelDiaEnParaguay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const aproximado = new Date(Date.UTC(y, m - 1, d, 12));
  const desfase = desfaseMinutos(aproximado);
  return new Date(Date.UTC(y, m - 1, d) + desfase * 60000);
}

/** Suma días a una fecha calendario, sin pasar por husos. */
export function sumarDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}
