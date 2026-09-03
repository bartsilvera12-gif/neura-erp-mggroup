/**
 * Une nombre y apellido sin repetir.
 *
 * Cuando el flujo pide «nombre y apellido» en un solo paso, el campo `nombre` ya trae el
 * apellido; si además quedó guardado el apellido suelto de una versión anterior del
 * flujo, concatenar los dos daba «Karen Ayala Ayala» en la boleta y en el CRM.
 *
 * Vive en un solo lugar porque el nombre se arma en dos caminos distintos —el que crea la
 * orden y el que dibuja el comprobante— y antes divergían.
 */
export function joinNombreApellido(nombre: string, apellido: string): string {
  const n = nombre.trim().replace(/\s+/g, " ");
  const a = apellido.trim().replace(/\s+/g, " ");
  if (!a) return n;
  if (!n) return a;
  const partes = n.toLocaleLowerCase("es").split(" ").filter(Boolean);
  if (partes.includes(a.toLocaleLowerCase("es"))) return n;
  return `${n} ${a}`;
}
