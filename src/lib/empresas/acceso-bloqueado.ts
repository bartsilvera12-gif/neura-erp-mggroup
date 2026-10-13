import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI } from "@/lib/empresas/mensaje-bloqueo";

/**
 * Corte del servicio por falta de pago.
 *
 * Una empresa con `acceso_bloqueado` no entra al ERP, su punto de venta deja de vender y su
 * bot de WhatsApp deja de contestar. No se borra ni se mueve nada: es una marca que se apaga
 * y todo vuelve como estaba.
 *
 * Dos cuidados de diseño:
 * - **Falla abierta.** Si la consulta falla o las columnas todavía no existen, se considera
 *   que la empresa NO está bloqueada. Un error de base no puede dejar a un cliente al día
 *   afuera de su sistema.
 * - **Cachea unos segundos.** El chequeo corre en cada llamada a la API y en cada mensaje de
 *   WhatsApp; sin caché sería una consulta extra por request. Al desbloquear, el cambio tarda
 *   a lo sumo lo que dure la caché.
 */

/** Mismo texto que ve la pantalla; la base puede pisarlo por empresa. */
export { MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI };

const SEGUNDOS_DE_CACHE = 20;

type EnCache = { bloqueada: boolean; mensaje: string | null; hasta: number };
const cache = new Map<string, EnCache>();

export type EstadoDeAcceso = { bloqueada: boolean; mensaje: string };

/** Olvida lo cacheado: se llama al bloquear o desbloquear para que el cambio se vea ya. */
export function olvidarEstadoDeAcceso(empresaId?: string): void {
  if (empresaId) cache.delete(empresaId.trim());
  else cache.clear();
}

export async function leerEstadoDeAcceso(
  empresaId: string | null | undefined,
  catalogSupabase?: AppSupabaseClient
): Promise<EstadoDeAcceso> {
  const id = (empresaId ?? "").trim();
  const libre: EstadoDeAcceso = { bloqueada: false, mensaje: "" };
  if (!id) return libre;

  const ahora = Date.now();
  const guardado = cache.get(id);
  if (guardado && guardado.hasta > ahora) {
    return {
      bloqueada: guardado.bloqueada,
      mensaje: guardado.bloqueada ? guardado.mensaje || MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI : "",
    };
  }

  try {
    const sb = catalogSupabase ?? createServiceRoleClient();
    const { data, error } = await sb
      .from("empresas")
      .select("acceso_bloqueado, acceso_bloqueado_mensaje")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      /** Sin las columnas todavía (antes de la migración) o sin permiso: no se bloquea a nadie. */
      cache.set(id, { bloqueada: false, mensaje: null, hasta: ahora + SEGUNDOS_DE_CACHE * 1000 });
      return libre;
    }
    const row = (data ?? {}) as { acceso_bloqueado?: boolean | null; acceso_bloqueado_mensaje?: string | null };
    const bloqueada = row.acceso_bloqueado === true;
    const mensaje = (row.acceso_bloqueado_mensaje ?? "").trim() || null;
    cache.set(id, { bloqueada, mensaje, hasta: ahora + SEGUNDOS_DE_CACHE * 1000 });
    return { bloqueada, mensaje: bloqueada ? mensaje || MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI : "" };
  } catch {
    return libre;
  }
}

/** Atajo para los puntos donde solo importa si pasa o no pasa. */
export async function empresaConAccesoBloqueado(
  empresaId: string | null | undefined,
  catalogSupabase?: AppSupabaseClient
): Promise<boolean> {
  return (await leerEstadoDeAcceso(empresaId, catalogSupabase)).bloqueada;
}

/** El super admin de Neura nunca queda afuera: es quien tiene que poder desbloquear. */
export function rolIgnoraBloqueo(rol: string | null | undefined): boolean {
  return (rol ?? "").trim() === "super_admin";
}
