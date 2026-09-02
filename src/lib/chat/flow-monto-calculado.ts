import "server-only";

import { getSorteoIdForChatFlow } from "@/lib/sorteos/sorteo-order-from-chat";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Total a pagar cuando la cantidad se pide por texto.
 *
 * Con botones, el monto venía en el payload de la opción. Al pedir la cantidad escrita
 * ya no hay payload, así que el resumen se queda sin `{{monto}}` y el cliente ve un
 * hueco. Acá se calcula `cantidad × sorteos.precio_por_boleto`, que es exactamente lo
 * que después cobra la orden cuando no hay precio de promo.
 */

/** Variables que quedan disponibles para los textos del flujo. */
export const MONTO_CALCULADO_KEYS = {
  precio: "precio_por_boleto",
  precioFmt: "precio_por_boleto_fmt",
  total: "monto_calculado",
  totalFmt: "monto_calculado_fmt",
  /** Se completa solo si el flujo no trajo un monto propio (promo). */
  monto: "monto",
  montoFmt: "monto_fmt",
} as const;

/** Formato guaraní: separador de miles con punto y sin decimales. */
export function formatGuaranies(valor: number): string {
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Math.round(valor));
}

function parseCantidad(raw: string | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * Devuelve las variables a fusionar con los datos del flujo. Vacío si el flujo no está
 * vinculado a un sorteo, si no hay cantidad todavía o si el precio no es válido: nunca
 * corta el envío del mensaje por no poder calcular.
 */
export async function buildMontoCalculadoVars(params: {
  supabase: AppSupabaseClient;
  empresaId: string;
  flowCode: string;
  flowData: Record<string, string>;
}): Promise<Record<string, string>> {
  const { supabase, empresaId, flowCode, flowData } = params;
  try {
    const cantidad = parseCantidad(flowData.cantidad ?? flowData.cantidad_boletos);
    if (cantidad == null) return {};

    const sorteoId = await getSorteoIdForChatFlow(supabase, empresaId, flowCode);
    if (!sorteoId) return {};

    const { data, error } = await supabase
      .from("sorteos")
      .select("precio_por_boleto")
      .eq("id", sorteoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error || !data) return {};

    const precio = Number((data as { precio_por_boleto?: number | string }).precio_por_boleto ?? 0);
    if (!Number.isFinite(precio) || precio <= 0) return {};

    const total = Math.round(precio * cantidad);
    const vars: Record<string, string> = {
      [MONTO_CALCULADO_KEYS.precio]: String(Math.round(precio)),
      [MONTO_CALCULADO_KEYS.precioFmt]: formatGuaranies(precio),
      [MONTO_CALCULADO_KEYS.total]: String(total),
      [MONTO_CALCULADO_KEYS.totalFmt]: formatGuaranies(total),
    };

    /** Un monto de promo ya cargado manda: solo se rellena si falta. */
    if (!String(flowData.monto ?? "").trim()) {
      vars[MONTO_CALCULADO_KEYS.monto] = String(total);
      vars[MONTO_CALCULADO_KEYS.montoFmt] = formatGuaranies(total);
    } else {
      const montoExistente = Number(String(flowData.monto).trim());
      if (Number.isFinite(montoExistente) && montoExistente > 0) {
        vars[MONTO_CALCULADO_KEYS.montoFmt] = formatGuaranies(montoExistente);
      }
    }
    return vars;
  } catch (e) {
    console.warn("[flow-monto-calculado] no_se_pudo_calcular", {
      flow_code: flowCode,
      message: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}
