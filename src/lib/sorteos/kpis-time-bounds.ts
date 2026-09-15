import { inicioDelDiaEnParaguay, sumarDias, ymdEnParaguay } from "@/lib/fecha-paraguay";

/**
 * Límites de día y mes calendario en America/Asuncion, expresados en ISO UTC para filtrar
 * columnas timestamptz en Postgres. `end` es inclusivo (el último milisegundo del período).
 *
 * Antes tenían UTC−4 escrito a mano; Paraguay está en UTC−3 desde octubre de 2024, así que
 * «Hoy» y «Mes» se corrían una hora: lo vendido entre las 23:00 y la medianoche contaba para
 * el día siguiente. Ahora el desfase sale del huso (`fecha-paraguay.ts`).
 */

/** Del primer instante del día `desdeYmd` al último del día `hastaYmd`, en Paraguay. */
export function asuncionRangeBoundsUtc(desdeYmd: string, hastaYmd: string): { start: string; end: string } {
  const start = inicioDelDiaEnParaguay(desdeYmd);
  const end = new Date(inicioDelDiaEnParaguay(sumarDias(hastaYmd, 1)).getTime() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function asuncionDayBoundsUtc(now = new Date()): { start: string; end: string } {
  const hoy = ymdEnParaguay(now);
  return asuncionRangeBoundsUtc(hoy, hoy);
}

export function asuncionMonthBoundsUtc(now = new Date()): { start: string; end: string } {
  const hoy = ymdEnParaguay(now);
  const primero = `${hoy.slice(0, 8)}01`;
  const [y, m] = hoy.split("-").map(Number);
  const primeroDelSiguiente = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return asuncionRangeBoundsUtc(primero, sumarDias(primeroDelSiguiente, -1));
}
