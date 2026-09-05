import "server-only";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Desbloqueo del POS por PIN.
 *
 * El link solo identifica al vendedor; el PIN es lo que autoriza a operar. Una vez validado,
 * se deja una cookie firmada en vez de guardar sesiones en base: el servidor puede verificarla
 * sin consultar nada.
 *
 * La firma incluye `pin_actualizado_at`, así que **regenerar el PIN invalida al instante todos
 * los desbloqueos anteriores**, que es justamente lo que se espera al rotarlo porque se filtró.
 */

export const RV_PIN_COOKIE = "neura_rv_pin";
/** Se re-pide el PIN cada 12 h: suficiente para una jornada, corto si se pierde el teléfono. */
export const RV_PIN_MAX_AGE = 60 * 60 * 12;

function secreto(): string {
  /**
   * Clave dedicada si existe; si no, la service role key, que ya es un secreto del servidor.
   * Nunca sale del backend: solo se usa para firmar.
   */
  return (
    process.env.REVENDEDOR_PIN_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

function firmar(payload: string): string {
  return createHmac("sha256", secreto()).update(payload).digest("hex");
}

function payloadDe(revendedorId: string, pinActualizadoAt: string, expiraEnMs: number): string {
  return [revendedorId, pinActualizadoAt, String(expiraEnMs)].join("|");
}

export function construirValorDesbloqueo(
  revendedorId: string,
  pinActualizadoAt: string | null
): string {
  const expira = Date.now() + RV_PIN_MAX_AGE * 1000;
  const p = payloadDe(revendedorId, pinActualizadoAt ?? "", expira);
  return `${expira}.${firmar(p)}`;
}

/**
 * ¿La cookie autoriza a este vendedor? Devuelve false ante cualquier anomalía: firma
 * inválida, vencida, formato raro o falta de secreto configurado.
 */
export function verificarValorDesbloqueo(
  valor: string | null | undefined,
  revendedorId: string,
  pinActualizadoAt: string | null
): boolean {
  if (!secreto()) return false;
  const v = (valor ?? "").trim();
  if (!v) return false;
  const punto = v.indexOf(".");
  if (punto <= 0) return false;

  const expiraStr = v.slice(0, punto);
  const firma = v.slice(punto + 1);
  const expira = Number(expiraStr);
  if (!Number.isFinite(expira) || expira <= Date.now()) return false;

  const esperada = firmar(payloadDe(revendedorId, pinActualizadoAt ?? "", expira));
  try {
    const a = Buffer.from(firma, "hex");
    const b = Buffer.from(esperada, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function posDesbloqueado(
  revendedorId: string,
  pinActualizadoAt: string | null
): Promise<boolean> {
  const jar = await cookies();
  return verificarValorDesbloqueo(
    jar.get(RV_PIN_COOKIE)?.value,
    revendedorId,
    pinActualizadoAt
  );
}
