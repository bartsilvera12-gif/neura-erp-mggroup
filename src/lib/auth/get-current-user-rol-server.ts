import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `usuarios.rol` del usuario autenticado (Server Components).
 *
 * Misma resolución de fila que el resto del ERP (`auth_user_id` y, si no, email). Devuelve
 * null si no hay sesión o el usuario no tiene ficha: quien llama debe tratar ese caso como
 * "sin privilegios", nunca como administrador.
 */
export async function getCurrentUserRolServer(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const sr = createServiceRoleClient();
    const usuario = await resolveUsuarioErpFromAuthUser(sr, user);
    const rol = (usuario?.rol ?? "").trim();
    return rol.length > 0 ? rol : null;
  } catch (e) {
    console.warn("[getCurrentUserRolServer]", e);
    return null;
  }
}
