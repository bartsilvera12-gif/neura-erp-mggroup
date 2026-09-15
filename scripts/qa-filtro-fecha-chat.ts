/**
 * Pruebas del filtro de chats por fecha (Hoy, Ayer, Semana, Mes, Rango), cortando los días
 * en hora de Paraguay.
 *
 * Correr con: npx tsx scripts/qa-filtro-fecha-chat.ts
 */
import { describirRangoFechaChat, rangoFechaChat } from "@/lib/chat/chat-filtro-fecha";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

/** Martes 15/09/2026, 10:00 en Asunción (UTC−3) = 13:00 UTC. */
const AHORA = new Date("2026-09-15T13:00:00Z");
const dentro = (r: ReturnType<typeof rangoFechaChat>, iso: string) =>
  Boolean(r) && iso >= r!.desdeIso && iso < r!.hastaIso;

console.log("\nHoy");
{
  const r = rangoFechaChat("hoy", null, null, AHORA);
  chequear("empieza a la medianoche de Paraguay", r?.desdeIso === "2026-09-15T03:00:00.000Z", r);
  chequear("termina a la medianoche siguiente", r?.hastaIso === "2026-09-16T03:00:00.000Z", r);
  chequear("un mensaje de las 23:30 de hoy entra", dentro(r, "2026-09-16T02:30:00.000Z"));
  chequear("uno de las 23:30 de ayer no", !dentro(r, "2026-09-15T02:30:00.000Z"));
}

console.log("\nA las 22:00 de Paraguay ya es mañana en UTC, y sigue siendo hoy");
{
  const noche = new Date("2026-09-16T01:00:00Z");
  const r = rangoFechaChat("hoy", null, null, noche);
  chequear("hoy es el 15, no el 16", r?.desdeYmd === "2026-09-15", r);
}

console.log("\nAyer, Semana, Mes");
{
  const ayer = rangoFechaChat("ayer", null, null, AHORA);
  chequear("ayer es el 14", ayer?.desdeYmd === "2026-09-14" && ayer?.hastaYmd === "2026-09-14", ayer);
  chequear("un mensaje del 14 a las 12:00 entra", dentro(ayer, "2026-09-14T15:00:00.000Z"));
  chequear("uno de hoy no", !dentro(ayer, "2026-09-15T12:00:00.000Z"));

  const semana = rangoFechaChat("semana", null, null, AHORA);
  chequear("semana: 7 días contando hoy", semana?.desdeYmd === "2026-09-09" && semana?.hastaYmd === "2026-09-15", semana);

  const mes = rangoFechaChat("mes", null, null, AHORA);
  chequear("mes: 30 días contando hoy", mes?.desdeYmd === "2026-08-17" && mes?.hastaYmd === "2026-09-15", mes);

  const lunes = rangoFechaChat("semana", null, null, new Date("2026-09-14T13:00:00Z"));
  chequear("un lunes la semana no queda en un solo día", lunes?.desdeYmd === "2026-09-08", lunes);
}

console.log("\nRango elegido");
{
  const r = rangoFechaChat("rango", "2026-09-01", "2026-09-08", AHORA);
  chequear("del 1 al 8", r?.desdeYmd === "2026-09-01" && r?.hastaYmd === "2026-09-08", r);
  chequear("el 8 entra completo (23:59)", dentro(r, "2026-09-09T02:59:00.000Z"));
  chequear("el 9 no", !dentro(r, "2026-09-09T03:00:00.000Z"));
  const alReves = rangoFechaChat("rango", "2026-09-08", "2026-09-01", AHORA);
  chequear("al revés se da vuelta solo", alReves?.desdeYmd === "2026-09-01" && alReves?.hastaYmd === "2026-09-08");
  const unDia = rangoFechaChat("rango", "2026-09-12", "", AHORA);
  chequear("sin «hasta» es un solo día", unDia?.desdeYmd === "2026-09-12" && unDia?.hastaYmd === "2026-09-12");
  chequear("fecha inválida: sin filtro", rangoFechaChat("rango", "12/09/2026", null, AHORA) === null);
  chequear("sin preset: sin filtro", rangoFechaChat(null, null, null, AHORA) === null);
  chequear("«todo»: sin filtro", rangoFechaChat("todo", null, null, AHORA) === null);
}

console.log("\nTexto del filtro");
{
  chequear(
    "semana",
    describirRangoFechaChat(rangoFechaChat("semana", null, null, AHORA)!, "semana") ===
      "Últimos 7 días (09/09/2026 al 15/09/2026)"
  );
  chequear("un día", describirRangoFechaChat(rangoFechaChat("hoy", null, null, AHORA)!, "hoy") === "Hoy (15/09/2026)");
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
