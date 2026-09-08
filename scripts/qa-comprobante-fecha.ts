/**
 * La fecha del comprobante: cuándo se rechaza y cuándo no.
 *
 * Lo que más importa acá es lo que NO tiene que rechazar. Un comprobante viejo que pasa lo
 * nota alguien; un pago bueno rechazado por una fecha mal leída es un cliente que se va.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobante-fecha.ts
 */
import {
  evaluarFechaComprobante,
  parsearFechaComprobantePy,
} from "@/lib/chat/comprobante-fecha-validation";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

/** Hoy es 8 de septiembre de 2026, como en el caso que reportó el cliente. */
const HOY = new Date(Date.UTC(2026, 8, 8, 14, 0, 0));
const evaluar = (fecha: string, maxDias = 3) =>
  evaluarFechaComprobante({ fechaOcr: fecha, maxDiasAntiguedad: maxDias, ahora: HOY });

console.log("\nEl caso del cliente: comprobante del 1 cuando es el 8");
{
  const r = evaluar("01/09/2026");
  chequear("lo rechaza", r.fueraDeVentana, r);
  chequear("dice que es muy vieja", r.motivo === "demasiado_vieja", r);
  chequear("cuenta 7 días", r.diasDeAntiguedad === 7, r);
}

console.log("\nLo que NO se rechaza");
{
  chequear("el de hoy", !evaluar("08/09/2026").fueraDeVentana);
  chequear("el de ayer", !evaluar("07/09/2026").fueraDeVentana);
  chequear("el del viernes con tope 3", !evaluar("05/09/2026").fueraDeVentana);
  chequear("el de mañana (reloj desfasado)", !evaluar("09/09/2026").fueraDeVentana);
  chequear("sin fecha legible", !evaluar("").fueraDeVentana);
  chequear("fecha con basura", !evaluar("ayer a las 8").fueraDeVentana);
  chequear("día imposible", !evaluar("32/09/2026").fueraDeVentana);
  chequear("mes imposible", !evaluar("01/13/2026").fueraDeVentana);
  chequear("31 de un mes de 30", !evaluar("31/09/2026").fueraDeVentana);
}

console.log("\nSe rechaza también lo que viene del futuro");
{
  const r = evaluar("20/09/2026");
  chequear("una fecha muy adelantada", r.fueraDeVentana, r);
  chequear("dice que está en el futuro", r.motivo === "en_el_futuro", r);
}

console.log("\nCon tope 0 solo entra el del día");
{
  chequear("hoy pasa", !evaluar("08/09/2026", 0).fueraDeVentana);
  chequear("ayer no", evaluar("07/09/2026", 0).fueraDeVentana);
}

console.log("\nFormatos de fecha");
{
  const casos: Array<[string, string | null]> = [
    ["01/09/2026", "2026-09-01"],
    ["01-09-2026", "2026-09-01"],
    ["01.09.2026", "2026-09-01"],
    ["1/9/26", "2026-09-01"],
    ["08/09/26", "2026-09-08"],
    ["", null],
    ["09/2026", null],
    ["texto", null],
  ];
  for (const [raw, esperado] of casos) {
    const d = parsearFechaComprobantePy(raw);
    const iso = d ? d.toISOString().slice(0, 10) : null;
    chequear(`«${raw}» → ${esperado ?? "no se lee"}`, iso === esperado, iso);
  }
  /** En Paraguay 01/09 es el 1 de septiembre, nunca el 9 de enero. */
  const d = parsearFechaComprobantePy("01/09/2026");
  chequear("día antes que mes", d?.getUTCMonth() === 8 && d?.getUTCDate() === 1, d?.toISOString());
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
