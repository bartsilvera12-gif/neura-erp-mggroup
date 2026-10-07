/**
 * Prueba determinística de la ventana horaria del recontacto (sin base de datos).
 *
 *   npx tsx scripts/test-recontact-schedule.ts
 */
import { isRecontactWindowOpen } from "@/lib/chat/recontact-schedule";

let fallos = 0;

function check(nombre: string, got: boolean, want: boolean): void {
  const ok = got === want;
  if (!ok) fallos += 1;
  console.log(`${ok ? "✓" : "✗"} ${nombre} → got=${got} want=${want}`);
}

// Instante de referencia: 2026-10-07 14:00 UTC = 11:00 en America/Asuncion (UTC-3), miércoles (weekday 3).
const miercoles11hPy = new Date("2026-10-07T14:00:00Z");
// 2026-10-07 02:00 UTC = 2026-10-06 23:00 en Asuncion, martes (weekday 2).
const martes23hPy = new Date("2026-10-07T02:00:00Z");
// 2026-10-11 14:00 UTC = 11:00 Asuncion, domingo (weekday 0).
const domingo11hPy = new Date("2026-10-11T14:00:00Z");

const tz = "America/Asuncion";

// 1. Config vacía → siempre abierta.
check("config vacía abre", isRecontactWindowOpen({}, miercoles11hPy), true);
check("null abre", isRecontactWindowOpen(null, miercoles11hPy), true);

// 2. Ventana 08:00-18:00: 11h dentro, 23h fuera.
check("08-18 incluye 11h", isRecontactWindowOpen({ window_start: "08:00", window_end: "18:00", timezone: tz }, miercoles11hPy), true);
check("08-18 excluye 23h", isRecontactWindowOpen({ window_start: "08:00", window_end: "18:00", timezone: tz }, martes23hPy), false);

// 3. Ventana que cruza medianoche 22:00-06:00: 23h dentro, 11h fuera.
check("22-06 incluye 23h", isRecontactWindowOpen({ window_start: "22:00", window_end: "06:00", timezone: tz }, martes23hPy), true);
check("22-06 excluye 11h", isRecontactWindowOpen({ window_start: "22:00", window_end: "06:00", timezone: tz }, miercoles11hPy), false);

// 4. Días activos (lun-vie = 1..5): miércoles dentro, domingo fuera.
check("lun-vie incluye miércoles", isRecontactWindowOpen({ active_weekdays: [1, 2, 3, 4, 5], timezone: tz }, miercoles11hPy), true);
check("lun-vie excluye domingo", isRecontactWindowOpen({ active_weekdays: [1, 2, 3, 4, 5], timezone: tz }, domingo11hPy), false);

// 5. Combinado día + hora: miércoles 11h con lun-vie 08-18 → abre; domingo 11h → cierra por día.
check(
  "combinado miércoles 11h abre",
  isRecontactWindowOpen({ active_weekdays: [1, 2, 3, 4, 5], window_start: "08:00", window_end: "18:00", timezone: tz }, miercoles11hPy),
  true
);
check(
  "combinado domingo 11h cierra",
  isRecontactWindowOpen({ active_weekdays: [1, 2, 3, 4, 5], window_start: "08:00", window_end: "18:00", timezone: tz }, domingo11hPy),
  false
);

if (fallos > 0) {
  console.error(`\n${fallos} caso(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodos los casos de ventana horaria pasaron.");
