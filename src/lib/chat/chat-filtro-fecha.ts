/**
 * Filtro de chats por fecha: Hoy, Ayer, Semana, Mes o un rango elegido.
 *
 * Los días se cortan en hora de Paraguay, no en la del servidor ni en UTC: una conversación
 * de las 22:00 del lunes en Asunción es de la 01:00 del martes en UTC, y sin esto caía en el
 * día equivocado. El desfase se lee del propio huso (`America/Asuncion`), así que sigue bien
 * aunque Paraguay vuelva a cambiar de horario.
 *
 * Sin dependencias de servidor: lo usa el inbox en el navegador para armar el pedido.
 */

import { inicioDelDiaEnParaguay, sumarDias, ymdEnParaguay } from "@/lib/fecha-paraguay";

export { inicioDelDiaEnParaguay, sumarDias, ymdEnParaguay };

export type PresetFechaChat = "hoy" | "ayer" | "semana" | "mes" | "rango";

export const PRESETS_FECHA_CHAT: ReadonlyArray<{ id: Exclude<PresetFechaChat, "rango">; label: string }> = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type RangoFechaChat = {
  /** ISO UTC, inclusive. */
  desdeIso: string;
  /** ISO UTC, exclusivo: el primer instante que ya queda afuera. */
  hastaIso: string;
  /** Para mostrar: primer y último día calendario del rango. */
  desdeYmd: string;
  hastaYmd: string;
};

/**
 * Rango de un preset. «Semana» son los últimos 7 días y «Mes» los últimos 30, contando hoy:
 * con la semana o el mes calendario, un lunes o un día 1 el filtro mostraba casi nada, y lo
 * que se busca suele ser «la semana pasada». Para «rango», `desde`/`hasta` son días
 * (AAAA-MM-DD) y `hasta` entra completo. null si el rango no es válido o no hay filtro.
 */
export function rangoFechaChat(
  preset: string | null | undefined,
  desde: string | null | undefined,
  hasta: string | null | undefined,
  ahora = new Date()
): RangoFechaChat | null {
  const hoy = ymdEnParaguay(ahora);
  let d: string;
  let h: string;
  switch (preset) {
    case "hoy":
      d = hoy;
      h = hoy;
      break;
    case "ayer":
      d = sumarDias(hoy, -1);
      h = d;
      break;
    case "semana":
      d = sumarDias(hoy, -6);
      h = hoy;
      break;
    case "mes":
      d = sumarDias(hoy, -29);
      h = hoy;
      break;
    case "rango": {
      const a = (desde ?? "").trim();
      const b = (hasta ?? "").trim() || a;
      if (!YMD.test(a) || !YMD.test(b)) return null;
      [d, h] = a <= b ? [a, b] : [b, a];
      break;
    }
    default:
      return null;
  }
  return {
    desdeIso: inicioDelDiaEnParaguay(d).toISOString(),
    hastaIso: inicioDelDiaEnParaguay(sumarDias(h, 1)).toISOString(),
    desdeYmd: d,
    hastaYmd: h,
  };
}

/** Texto corto del filtro activo, para el aviso encima de la lista. */
export function describirRangoFechaChat(r: RangoFechaChat, preset: string | null | undefined): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  };
  const nombre =
    preset === "hoy"
      ? "Hoy"
      : preset === "ayer"
        ? "Ayer"
        : preset === "semana"
          ? "Últimos 7 días"
          : preset === "mes"
            ? "Últimos 30 días"
            : "";
  const dias = r.desdeYmd === r.hastaYmd ? fmt(r.desdeYmd) : `${fmt(r.desdeYmd)} al ${fmt(r.hastaYmd)}`;
  return nombre ? `${nombre} (${dias})` : dias;
}
