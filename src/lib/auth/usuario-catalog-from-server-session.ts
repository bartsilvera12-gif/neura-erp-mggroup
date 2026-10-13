import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { empresaConAccesoBloqueado, rolIgnoraBloqueo } from "@/lib/empresas/acceso-bloqueado";

/**
 * Resuelve `zentra_erp.usuarios` en Server Actions / RSC usando cookies de sesión:
 * `getUser` + lectura de catálogo con service role (misma idea que `resolveApiAuthContext`).
 */
export async function getUsuarioCatalogFromServerCookies(): Promise<{
  id: string;
  empresa_id: string;
} | null> {
  const catalogClient = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await catalogClient.auth.getUser();
  if (error || !user?.id) return null;

  const sr = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(sr, user);
  if (!usuario?.id) return null;
  if (!usuario.empresa_id) return null;

  /** Mismo corte que en las rutas API: las acciones de servidor tampoco corren si no se pagó. */
  if (!rolIgnoraBloqueo(usuario.rol) && (await empresaConAccesoBloqueado(usuario.empresa_id, sr))) {
    return null;
  }

  return { id: usuario.id, empresa_id: usuario.empresa_id };
}
