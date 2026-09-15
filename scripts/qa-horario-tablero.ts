/**
 * Pruebas de los cortes de día y mes del tablero de sorteos, en hora de Paraguay (UTC−3).
 *
 * Antes «Hoy» y «Mes» tenían UTC−4 escrito a mano y el filtro desde/hasta cortaba en UTC:
 * una venta de las 23:30 contaba para el día siguiente.
 *
 * Correr con: npx tsx scripts/qa-horario-tablero.ts
 */
import {
  asuncionDayBoundsUtc,
  asuncionMonthBoundsUtc,
  asuncionRangeBoundsUtc,
} from "@/lib/sorteos/kpis-time-bounds";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

const dentro = (b: { start: string; end: string }, iso: string) => iso >= b.start && iso <= b.end;

/** Martes 15/09/2026, 10:00 en Asunción = 13:00 UTC. */
const AHORA = new Date("2026-09-15T13:00:00Z");

console.log("\nHoy");
{
  const b = asuncionDayBoundsUtc(AHORA);
  chequear("empieza a las 00:00 de Paraguay (03:00 UTC)", b.start === "2026-09-15T03:00:00.000Z", b);
  chequear("termina a las 23:59:59.999", b.end === "2026-09-16T02:59:59.999Z", b);
  chequear("una venta de las 23:30 cuenta para hoy", dentro(b, "2026-09-16T02:30:00.000Z"));
  chequear("una de las 00:10 de mañana no", !dentro(b, "2026-09-16T03:10:00.000Z"));
  chequear("una de las 23:30 de ayer no", !dentro(b, "2026-09-15T02:30:00.000Z"));
}

console.log("\nA las 23:00 de Paraguay (ya es mañana en UTC) sigue siendo hoy");
{
  const b = asuncionDayBoundsUtc(new Date("2026-09-16T02:00:00Z"));
  chequear("el día es el 15", b.start === "2026-09-15T03:00:00.000Z", b);
}

console.log("\nMes");
{
  const b = asuncionMonthBoundsUtc(AHORA);
  chequear("del 1/9 a las 00:00", b.start === "2026-09-01T03:00:00.000Z", b);
  chequear("al 30/9 a las 23:59:59.999", b.end === "2026-10-01T02:59:59.999Z", b);
  chequear("la última hora del mes entra", dentro(b, "2026-10-01T02:30:00.000Z"));
  const dic = asuncionMonthBoundsUtc(new Date("2026-12-10T15:00:00Z"));
  chequear("diciembre cruza al año siguiente", dic.start === "2026-12-01T03:00:00.000Z" && dic.end === "2027-01-01T02:59:59.999Z", dic);
  const feb = asuncionMonthBoundsUtc(new Date("2028-02-10T15:00:00Z"));
  chequear("febrero bisiesto termina el 29", feb.end === "2028-03-01T02:59:59.999Z", feb);
}

console.log("\nFiltro desde/hasta del tablero");
{
  const b = asuncionRangeBoundsUtc("2026-09-14", "2026-09-14");
  chequear("una venta del lunes 14 a las 22:00 cuenta para el 14", dentro(b, "2026-09-15T01:00:00.000Z"));
  chequear("una del martes 15 a las 01:00 no", !dentro(b, "2026-09-15T04:00:00.000Z"));
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
