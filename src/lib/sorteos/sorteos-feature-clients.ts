/**
 * Habilitación de features de UI de Sorteos por cliente (schema single_client).
 *
 * Esto es SOLO habilitación de UI/feature (mostrar botón "Finalizar", ocultar
 * subitem duplicado del sidebar, etc.), NO lógica de negocio de sorteos.
 *
 * Históricamente estas condiciones estaban hardcodeadas a `elpapustore_erp`.
 * MG GROUP (`mggroup`) también es cliente de Sorteos, por lo que se centraliza
 * la lista acá para no depender de un único schema y no romper El Papu Store.
 *
 * Para agregar un cliente nuevo de Sorteos: sumar su `NEURA_CLIENT_SCHEMA` al set.
 */
const SORTEOS_CLIENT_SCHEMAS: ReadonlySet<string> = new Set<string>([
  "elpapustore_erp",
  "mggroup",
]);

/**
 * ¿El schema corresponde a un cliente con las features de UI de Sorteos habilitadas?
 *
 * Pensado para recibir `process.env.NEXT_PUBLIC_NEURA_CLIENT_SCHEMA` (browser) o
 * el schema resuelto en server. Tolera `null`/`undefined`/espacios.
 */
export function isSorteosClientSchema(schema: string | null | undefined): boolean {
  const s = typeof schema === "string" ? schema.trim() : "";
  return s.length > 0 && SORTEOS_CLIENT_SCHEMAS.has(s);
}
