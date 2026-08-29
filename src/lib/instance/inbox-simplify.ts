/**
 * Inbox simplificado para instancias tipo "sorteos" (p. ej. MG GROUP).
 *
 * Este cliente no usa la operativa omnicanal completa (múltiples canales, colas,
 * asignación de agentes), así que ocultamos elementos de UI que solo agregan ruido:
 *   - La barra de filtros Canal / Cola / Asignación del inbox.
 *   - La fila de chips de meta debajo del contacto (canal, estado, cola, agente, CRM/Cliente).
 *
 * Es puramente cosmético: no cambia el ruteo ni los datos. Los filtros quedan en su
 * valor por defecto (todos los canales, todas las colas, todas las asignaciones).
 *
 * Reversible:
 *   - Poné NEXT_PUBLIC_NEURA_SIMPLE_INBOX="0" en el entorno para volver a la vista completa.
 *   - Default en esta instancia: activado (vista simplificada).
 */
export const SIMPLE_INBOX_UI: boolean =
  (process.env.NEXT_PUBLIC_NEURA_SIMPLE_INBOX ?? "1").trim() !== "0";
