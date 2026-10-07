import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { assertFlowBelongsToEmpresa } from "@/lib/chat/recontact-rules-validation";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

type RecontactRunRow = {
  id: string;
  conversation_id: string | null;
  decision: string;
  skip_reason: string | null;
  attempt_no: number | null;
  correlation_id: string | null;
  payload_snapshot: unknown;
  created_at: string;
};

/** Historial de intentos de recontacto de una regla (para la pantalla de monitoreo). */
export async function GET(
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

    const url = new URL(request.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;

    const supabase = await getChatServiceClientForEmpresa(empresaId);
    await assertFlowBelongsToEmpresa(supabase, empresaId, flowCode);

    const { data, error } = await supabase
      .from("chat_flow_recontact_runs")
      .select("id, conversation_id, decision, skip_reason, attempt_no, correlation_id, payload_snapshot, created_at")
      .eq("empresa_id", empresaId)
      .eq("rule_id", ruleId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, items: (data ?? []) as RecontactRunRow[] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/:flowCode/recontact-rules/:ruleId/runs][GET]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
