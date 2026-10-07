/**
 * Evaluación de la franja horaria (`schedule_config`) de una regla de recontacto.
 * Reutiliza `getZonedWeekdayAndMinutes` (zona horaria vía Intl) del runtime de automatizaciones.
 *
 * Forma de `schedule_config` (ver `recontact-rules-validation.ts` → `normalizeSchedule`):
 *   { window_start?: "HH:MM" | null, window_end?: "HH:MM" | null,
 *     timezone?: string | null, active_weekdays?: number[] | null }   // 0=Dom … 6=Sáb
 */
export const RECONTACT_DEFAULT_TIMEZONE = "America/Asuncion";

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Día de la semana (0=Dom … 6=Sáb) y minutos desde medianoche en la zona dada, vía Intl.
 * Mismo cálculo que `getZonedWeekdayAndMinutes` del runtime de automatizaciones, replicado acá
 * para no acoplar la evaluación de horario a la cadena de envío de WhatsApp.
 */
function getZonedWeekdayAndMinutes(date: Date, timeZone: string): { weekday: number; minutes: number } | null {
  const tz = timeZone.trim() || "UTC";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = dtf.formatToParts(date);
    let weekday = 0;
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === "weekday") weekday = WEEKDAY_SHORT[p.value] ?? 0;
      if (p.type === "hour") hour = parseInt(p.value, 10) || 0;
      if (p.type === "minute") minute = parseInt(p.value, 10) || 0;
    }
    return { weekday, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

export type RecontactScheduleConfigInput = {
  window_start?: string | null;
  window_end?: string | null;
  timezone?: string | null;
  active_weekdays?: number[] | null;
};

function parseHm(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + min;
}

function parseSchedule(raw: unknown): RecontactScheduleConfigInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const active = Array.isArray(o.active_weekdays)
    ? o.active_weekdays
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : null;
  return {
    window_start: typeof o.window_start === "string" ? o.window_start : null,
    window_end: typeof o.window_end === "string" ? o.window_end : null,
    timezone: typeof o.timezone === "string" ? o.timezone : null,
    active_weekdays: active && active.length > 0 ? active : null,
  };
}

/**
 * Devuelve `true` si `now` cae dentro de la franja permitida por la regla.
 * - Config vacía (sin horas ni días) → siempre abierta.
 * - `active_weekdays` presente → el día actual debe estar en la lista (0=Dom … 6=Sáb).
 * - `window_start`/`window_end` ambos presentes → hora dentro del rango; soporta cruce de
 *   medianoche (ej. 22:00 → 06:00).
 */
export function isRecontactWindowOpen(scheduleConfig: unknown, now: Date = new Date()): boolean {
  const cfg = parseSchedule(scheduleConfig);
  const tz = (cfg.timezone && cfg.timezone.trim()) || RECONTACT_DEFAULT_TIMEZONE;

  const hasDays = Array.isArray(cfg.active_weekdays) && cfg.active_weekdays.length > 0;
  const start = parseHm(cfg.window_start);
  const end = parseHm(cfg.window_end);
  const hasWindow = start !== null && end !== null;

  if (!hasDays && !hasWindow) return true;

  const zm = getZonedWeekdayAndMinutes(now, tz);
  if (!zm) return true; // zona inválida → no bloquear

  if (hasDays && !cfg.active_weekdays!.includes(zm.weekday)) return false;

  if (hasWindow) {
    if (end! <= start!) {
      // cruza medianoche
      return zm.minutes >= start! || zm.minutes < end!;
    }
    return zm.minutes >= start! && zm.minutes < end!;
  }

  return true;
}
