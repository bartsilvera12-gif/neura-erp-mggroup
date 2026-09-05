import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import { getSingleClientSchemaOrNull, isSingleClientMode } from "@/lib/instance/single-client";
import { enProcesamientoDeWebhook } from "@/lib/chat/webhook-timing";

/** Slug + sufijo hex de empresa (p. ej. erp_demo_audit_3b885371). */
const RE_ERP = /^erp_[a-zA-Z0-9_]+$/;
const RE_ER_UUID = /^er_[0-9a-f]{32}$/;
/** Schema canónico de instancia dedicada single_client (p. ej. "elpapustore"). */
const RE_SINGLE_CLIENT_SLUG = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * Valida nombre de schema Postgres para interpolación segura en SQL (solo datos chat).
 */
export function assertAllowedChatDataSchema(schema: string): string {
  const s = schema.trim();
  if (!s) throw new Error("schema vacío");
  if (s === "public" || s === SUPABASE_APP_SCHEMA) return s;
  if (RE_ERP.test(s) || RE_ER_UUID.test(s)) return s;
  // single_client: el schema dedicado declarado en NEURA_CLIENT_SCHEMA es válido.
  // Aceptamos solo cuando el modo está activo y el slug coincide exactamente con la env;
  // así no se relaja la validación para multi_tenant.
  if (isSingleClientMode()) {
    const sc = getSingleClientSchemaOrNull();
    if (sc && s === sc && RE_SINGLE_CLIENT_SLUG.test(s)) return s;
  }
  throw new Error(`schema no permitido: ${s}`);
}

/**
 * ¿Las consultas de chat de este esquema van por Postgres directo en vez de PostgREST?
 *
 * Dos motivos distintos para que sí:
 *
 * 1. Obligación: en esquemas `erp_*` / `er_<hex>` PostgREST falla si no están en "Exposed
 *    schemas". Ahí el directo es la única opción y siempre estuvo activo.
 *
 * 2. Velocidad: en single_client PostgREST funciona, pero cada consulta sale por la URL
 *    pública —o sea con TLS y, si hay CDN adelante, un salto extra— mientras que el directo
 *    reusa conexiones del pool. Con la aplicación lejos de la base, y siendo decenas de
 *    consultas por mensaje, la diferencia se acumula.
 *
 * El caso 2 va detrás de `CHAT_PG_DIRECTO=true` y **solo dentro del webhook del bot**. Esa
 * restricción es deliberada: el pool directo es chico (3 conexiones por proceso salvo que se
 * suba `PG_POOL_MAX`) y cada mensaje en curso ocupa una. Si la bandeja, el CRM y los sorteos
 * compartieran ese pool, un supervisor recargando el panel le quitaría conexiones al bot justo
 * cuando alguien está comprando, y al pasar los 12 s de espera la consulta no se demora: falla.
 * Fuera del webhook se sigue usando PostgREST, que tiene su propio pool del lado del servidor
 * y aguanta mucha más concurrencia.
 *
 * El shim que lo implementa ya corre en producción para los clientes del caso 1, así que no es
 * código nuevo; lo nuevo es usarlo acá. La variable permite volver atrás sin tocar código.
 */
export function debeUsarPostgresDirectoParaChat(schema: string): boolean {
  const s = schema.trim();
  if (!s || s === SUPABASE_APP_SCHEMA || s === "public") return false;
  if (RE_ERP.test(s) || RE_ER_UUID.test(s)) return true;

  if (process.env.CHAT_PG_DIRECTO?.trim().toLowerCase() !== "true") return false;
  if (!enProcesamientoDeWebhook()) return false;
  if (!isSingleClientMode()) return false;
  const sc = getSingleClientSchemaOrNull();
  return Boolean(sc && s === sc && RE_SINGLE_CLIENT_SLUG.test(s));
}

/**
 * Nombre histórico, con 81 usos en el código. Se mantiene como alias para no ensuciar el
 * diff con un renombre masivo; el nombre nuevo describe mejor lo que decide hoy.
 */
export function isLikelyUnexposedTenantChatSchema(schema: string): boolean {
  return debeUsarPostgresDirectoParaChat(schema);
}
