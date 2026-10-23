import "server-only";

import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getUsuarioCatalogFromServerCookies } from "@/lib/auth/usuario-catalog-from-server-session";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import {
  cargarResumenImpresionCupones,
  type ResumenImpresionCupones,
} from "@/lib/sorteos/tandas-impresas-pg";

/**
 * Resumen de impresión para la pantalla de Cupones.
 *
 * Devuelve null —y la pantalla no muestra el panel— cuando el despliegue no tiene base directa
 * o la consulta falla: es información de apoyo, no puede romper la página de cupones.
 */
export async function cargarResumenImpresionCuponesServer(
  sorteoId: string
): Promise<ResumenImpresionCupones | null> {
  const sid = sorteoId.trim();
  if (!sid) return null;
  const pool = getChatPostgresPool();
  if (!pool) return null;
  try {
    const usuario = await getUsuarioCatalogFromServerCookies();
    if (!usuario?.empresa_id) return null;
    const schema = await fetchDataSchemaForEmpresaId(usuario.empresa_id);
    return await cargarResumenImpresionCupones(pool, schema, usuario.empresa_id, sid);
  } catch (e) {
    console.warn("[sorteos-cupones] resumen_impresion_no_disponible", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
