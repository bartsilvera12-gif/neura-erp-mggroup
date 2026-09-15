import "server-only";

import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { persistOutgoingChatMessage } from "@/lib/chat/outgoing-message-persist";
import {
  resolveOutboundTextContextFromIds,
  sendOutboundTextMessage,
} from "@/lib/chat/outbound-send-dispatch";
import {
  SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD,
  SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD,
  SORTEO_COMPROBANTE_VALIDACION_ID_FIELD,
} from "@/lib/chat/comprobante-validation-types";
import { MENSAJE_RECHAZO_POR_DEFECTO } from "@/lib/sorteos/comprobantes-compras-tipos";


export type ResultadoRechazo =
  | { ok: true; ordenRechazada: boolean; avisado: boolean; avisoError?: string }
  | { ok: false; message: string };

/**
 * Rechaza a mano un comprobante.
 *
 * Deja el comprobante en `rechazado_manual`, con quién, cuándo y por qué (las mismas columnas
 * que la aprobación manual, con `manual_approval_source = 'erp_rechazo'`). Si el comprobante
 * ya había generado una compra, la compra pasa a `rechazado`, igual que al anular una venta:
 * sale de los totales y de la impresión, pero las boletas no se borran, para que sigan siendo
 * rastreables.
 *
 * En el chat, el estado del comprobante que guarda el flujo pasa a rechazado, así el bot no
 * cierra una compra con él aunque la persona siga en ese paso. Si se pide, se le avisa por
 * WhatsApp; si el aviso falla, el rechazo igual queda hecho.
 */
export async function rechazarComprobanteManual(input: {
  supabase: AppSupabaseClient;
  empresaId: string;
  usuarioId: string;
  validacionId: string;
  motivo: string;
  avisarCliente: boolean;
  mensaje?: string | null;
}): Promise<ResultadoRechazo> {
  const db = input.supabase;
  const vid = input.validacionId.trim();
  const motivo = input.motivo.trim().slice(0, 500);
  if (!vid) return { ok: false, message: "Comprobante inválido." };
  if (motivo.length < 3) return { ok: false, message: "Escribí el motivo del rechazo." };

  const { data: row, error } = await db
    .from("chat_comprobante_validaciones")
    .select("id, estado_validacion, motivo_validacion, conversation_id, flow_session_id, sorteo_entrada_id")
    .eq("id", vid)
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!row) return { ok: false, message: "No se encontró el comprobante." };
  const v = row as {
    id: string;
    estado_validacion: string | null;
    motivo_validacion: string | null;
    conversation_id: string | null;
    flow_session_id: string | null;
    sorteo_entrada_id: string | null;
  };
  if (v.estado_validacion === "rechazado_manual") {
    return { ok: false, message: "Este comprobante ya estaba rechazado." };
  }

  const ahora = new Date().toISOString();
  const { error: upErr } = await db
    .from("chat_comprobante_validaciones")
    .update({
      estado_validacion: "rechazado_manual",
      motivo_validacion: "rechazado_por_admin",
      previous_estado_validacion: v.estado_validacion,
      previous_motivo_validacion: v.motivo_validacion,
      manual_approval_usuario_id: input.usuarioId,
      manual_approval_at: ahora,
      manual_approval_source: "erp_rechazo",
      manual_approval_note: motivo,
      updated_at: ahora,
    })
    .eq("id", v.id)
    .eq("empresa_id", input.empresaId);
  if (upErr) return { ok: false, message: upErr.message };

  let ordenRechazada = false;
  if (v.sorteo_entrada_id) {
    const { data: ent } = await db
      .from("sorteo_entradas")
      .select("id, estado_pago, observacion_interna")
      .eq("id", v.sorteo_entrada_id)
      .eq("empresa_id", input.empresaId)
      .maybeSingle();
    const e = ent as { id: string; estado_pago: string | null; observacion_interna: string | null } | null;
    if (e && e.estado_pago !== "rechazado") {
      const rastro = `COMPROBANTE RECHAZADO ${ahora.slice(0, 16).replace("T", " ")}: ${motivo.slice(0, 200)}`;
      const { error: eErr } = await db
        .from("sorteo_entradas")
        .update({
          estado_pago: "rechazado",
          observacion_interna: e.observacion_interna ? `${e.observacion_interna}\n${rastro}` : rastro,
          updated_at: ahora,
        })
        .eq("id", e.id)
        .eq("empresa_id", input.empresaId);
      if (eErr) {
        console.warn("[comprobante-rechazo] orden_no_actualizada", { entrada_id: e.id, message: eErr.message });
      } else {
        ordenRechazada = true;
      }
    }
  }

  /** Solo si el flujo todavía tiene este comprobante como el vigente: uno más nuevo no se toca. */
  if (v.flow_session_id) {
    const { data: vigente } = await db
      .from("chat_flow_data")
      .select("field_value")
      .eq("flow_session_id", v.flow_session_id)
      .eq("field_name", SORTEO_COMPROBANTE_VALIDACION_ID_FIELD)
      .maybeSingle();
    if (String((vigente as { field_value?: unknown } | null)?.field_value ?? "").trim() === v.id) {
      for (const [campo, valor] of [
        [SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD, "rechazado_manual"],
        [SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD, "rechazado_por_admin"],
      ] as const) {
        await db
          .from("chat_flow_data")
          .update({ field_value: valor, updated_at: ahora })
          .eq("flow_session_id", v.flow_session_id)
          .eq("field_name", campo);
      }
    }
  }

  console.info("[comprobante-rechazo] ok", {
    validacion_id: v.id,
    empresa_id: input.empresaId,
    usuario_id: input.usuarioId,
    orden_rechazada: ordenRechazada,
  });

  if (!input.avisarCliente || !v.conversation_id) {
    return { ok: true, ordenRechazada, avisado: false };
  }

  const texto = (input.mensaje ?? "").trim() || MENSAJE_RECHAZO_POR_DEFECTO;
  try {
    const { data: conv } = await db
      .from("chat_conversations")
      .select("contact_id, channel_id")
      .eq("id", v.conversation_id)
      .maybeSingle();
    const c = conv as { contact_id?: string | null; channel_id?: string | null } | null;
    if (!c?.contact_id || !c.channel_id) {
      return { ok: true, ordenRechazada, avisado: false, avisoError: "La conversación no tiene canal." };
    }
    const outbound = await resolveOutboundTextContextFromIds(
      db,
      { contactId: c.contact_id, channelId: c.channel_id },
      { dataSchema: await fetchDataSchemaForEmpresaId(input.empresaId), empresaId: input.empresaId }
    );
    const r = await sendOutboundTextMessage(outbound, texto.slice(0, 4096));
    if (!r.ok) return { ok: true, ordenRechazada, avisado: false, avisoError: r.error };
    await persistOutgoingChatMessage(db, {
      conversation: { id: v.conversation_id, empresa_id: input.empresaId },
      content: texto,
      messageType: "text",
      waMessageId: r.waMessageId ?? null,
      raw: r.raw ?? {},
      senderType: "human",
      automationSource: "comprobante_rechazo_manual",
    });
    return { ok: true, ordenRechazada, avisado: true };
  } catch (e) {
    return {
      ok: true,
      ordenRechazada,
      avisado: false,
      avisoError: e instanceof Error ? e.message : "No se pudo avisar por WhatsApp.",
    };
  }
}
