import "server-only";

import { parseComprobanteValidationConfig } from "@/lib/chat/comprobante-validation-types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Datos bancarios del canal (config.comprobante_validation.datos_bancarios_esperados)
 * como variables para los textos del flujo:
 * {{banco_titular}}, {{banco_entidad}}, {{banco_cuenta}} y {{banco_alias}}.
 * Si cambian en la configuración del canal, el mensaje toma el valor nuevo solo.
 */
export async function buildBancoVars(params: {
  supabase: AppSupabaseClient;
  channelId: string | null | undefined;
}): Promise<Record<string, string>> {
  const { supabase, channelId } = params;
  if (!channelId) return {};
  try {
    const { data, error } = await supabase
      .from("chat_channels")
      .select("config")
      .eq("id", channelId)
      .maybeSingle();
    if (error || !data) return {};
    const d = parseComprobanteValidationConfig((data as { config?: unknown }).config)
      .datos_bancarios_esperados;
    return {
      banco_titular: d.titular ?? "",
      banco_entidad: d.banco ?? "",
      banco_cuenta: d.numero_cuenta ?? "",
      banco_alias: d.alias ?? "",
    };
  } catch (e) {
    console.warn("[flow-banco-vars] no_se_pudo_leer", e instanceof Error ? e.message : e);
    return {};
  }
}
