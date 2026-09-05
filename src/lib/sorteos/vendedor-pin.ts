import "server-only";

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";

/**
 * PIN de acceso del vendedor al POS.
 *
 * El PIN NUNCA se guarda en claro: se almacena `scrypt$<sal>$<hash>`. Ni el administrador
 * que lo genera puede recuperarlo después — solo puede generar uno nuevo. Es el mismo
 * criterio que cualquier contraseña, aunque sea corto.
 */

const LARGO_PIN = 6;
const KEYLEN = 32;

/** Genera un PIN numérico legible por teléfono. `randomInt` es aleatoriedad criptográfica. */
export function generarPin(): string {
  let pin = "";
  for (let i = 0; i < LARGO_PIN; i++) pin += String(randomInt(0, 10));
  return pin;
}

export function hashPin(pin: string): string {
  const sal = randomBytes(16).toString("hex");
  const hash = scryptSync(pin.trim(), sal, KEYLEN).toString("hex");
  return `scrypt$${sal}$${hash}`;
}

/**
 * Compara en tiempo constante. Devuelve false ante cualquier formato inesperado en vez de
 * lanzar: un hash corrupto no debe tumbar el login, solo rechazarlo.
 */
export function verificarPin(pin: string, guardado: string | null | undefined): boolean {
  const g = (guardado ?? "").trim();
  if (!g) return false;
  const partes = g.split("$");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  const [, sal, hashHex] = partes;
  if (!sal || !hashHex) return false;
  try {
    const esperado = Buffer.from(hashHex, "hex");
    const calculado = scryptSync(pin.trim(), sal, esperado.length);
    if (esperado.length !== calculado.length) return false;
    return timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}

/** ¿El PIN que eligió el administrador es aceptable? Solo dígitos, 4 a 8. */
export function validarPinElegido(pin: string): { ok: true } | { ok: false; motivo: string } {
  const p = pin.trim();
  if (!/^\d{4,8}$/.test(p)) {
    return { ok: false, motivo: "El PIN debe tener entre 4 y 8 dígitos, solo números." };
  }
  /** Un PIN de un solo dígito repetido o correlativo se adivina al primer intento. */
  if (/^(\d)\1+$/.test(p)) {
    return { ok: false, motivo: "El PIN no puede ser el mismo dígito repetido." };
  }
  if ("0123456789".includes(p) || "9876543210".includes(p)) {
    return { ok: false, motivo: "El PIN no puede ser una secuencia como 1234." };
  }
  return { ok: true };
}
