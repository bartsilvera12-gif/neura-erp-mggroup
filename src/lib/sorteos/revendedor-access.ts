import { randomBytes } from "crypto";

/**
 * Acceso del revendedor por "link mágico" (POS de revendedores).
 *
 * El token es opaco, largo y único (índice único parcial en `sorteo_revendedores`
 * mientras `access_revoked_at IS NULL`). El revendedor abre `/rv/:token` una vez y
 * queda logueado en ese dispositivo vía cookie de sesión firmada (ver revendedor-session).
 */

const TOKEN_PREFIX = "rv_";

/** Genera un token opaco (~43 chars base64url + prefijo). */
export function generateRevendedorAccessToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function looksLikeRevendedorAccessToken(token: string): boolean {
  const t = token.trim();
  return t.startsWith(TOKEN_PREFIX) && t.length >= TOKEN_PREFIX.length + 20 && t.length <= 200;
}

/** URL pública del POS del revendedor. `baseUrl` = origin del ERP (sin barra final necesaria). */
export function buildRevendedorPosUrl(baseUrl: string, token: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/rv/${encodeURIComponent(token.trim())}`;
}
