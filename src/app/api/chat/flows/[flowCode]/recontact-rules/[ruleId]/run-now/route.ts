import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { assertFlowBelongsToEmpresa } from "@/lib/chat/recontact-rules-validation";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { runRecontactForEmpresa } from "@/lib/chat/recontact-executor";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

const MANUAL_MAX_SEND = 20;

/**
 * Disparo manual ("enviar ahora") de UNA regla de recontacto desde el panel.
 * Envía WhatsApp real (tope {@link MANUAL_MAX_SEND}). Con `{ dry_run: true }` solo simula.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; ruleId: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const params = await context.params;
    const flowCode = decodeURIComponent(params.flowCode ?? "").trim();
    const ruleId = decodeURIComponent(params.ruleId ?? "").trim();
    if (!flowCode) return NextResponse.json({ ok: false, error: "flowCode inválido" }, { status: 400 });
    if (!ruleId || !isUuid(ruleId)) {
      return NextResponse.json({ ok: false, error: "ruleId inválido" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const dryRun = body.dry_run === true;

    const supabase = await getChatServiceClientForEmpresa(empresaId);
    await assertFlowBelongsToEmpresa(supabase, empresaId, flowCode);

    // La regla debe existir y pertenecer a esta empresa + flujo.
    const { data: rule, error: ruleErr } = await supabase
      .from("chat_flow_recontact_rules")
      .select("id")
      .eq("id", ruleId)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .maybeSingle();
    if (ruleErr) return NextResponse.json({ ok: false, error: ruleErr.message }, { status: 400 });
    if (!rule) return NextResponse.json({ ok: false, error: "Regla no encontrada" }, { status: 404 });

    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);

    const result = await runRecontactForEmpresa({
      empresaId,
      ruleId,
      dryRun,
      maxSend: MANUAL_MAX_SEND,
      supabase,
      dataSchema,
    });

    const ruleResult = result.por_regla.find((r) => r.rule_id === ruleId) ?? null;

    return NextResponse.json({
      ok: true,
      dry_run: result.dry_run,
      locked: result.locked,
      resultado: ruleResult,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/:flowCode/recontact-rules/:ruleId/run-now][POST]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
