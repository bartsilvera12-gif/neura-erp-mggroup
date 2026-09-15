"use server";

import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { rechazarComprobanteManual, type ResultadoRechazo } from "@/lib/chat/comprobante-rechazo-manual";

/**
 * Rechazo manual de un comprobante, desde el inbox o desde Sorteos → Comprobantes.
 * La aprobación manual es `approveComprobanteValidacion` (en `@/lib/chat/actions`).
 */
export async function rejectComprobanteValidacion(input: {
  validacionId: string;
  motivo: string;
  avisarCliente: boolean;
  mensaje?: string | null;
}): Promise<ResultadoRechazo> {
  const { supabase, empresa_id, usuario_id } = await requireEmpresaTenantServiceRole();
  return rechazarComprobanteManual({
    supabase,
    empresaId: empresa_id,
    usuarioId: usuario_id,
    validacionId: input.validacionId,
    motivo: input.motivo,
    avisarCliente: input.avisarCliente,
    mensaje: input.mensaje,
  });
}
