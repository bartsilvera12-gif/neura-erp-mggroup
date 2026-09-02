import { NextRequest, NextResponse } from "next/server";
import { markMissingFlowNodeColumns } from "@/lib/chat/flow-node-columns";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";

const VALID_NODE_TYPES = ["buttons", "list", "text", "media", "image_input", "human", "end"] as const;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; nodeCode: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const targetCode = params.nodeCode;
    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);

    const { data: targetNode, error: targetErr } = await supabase
      .from("chat_flow_nodes")
      .select("id, node_code")
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", params.flowCode)
      .eq("node_code", targetCode)
      .maybeSingle();
    if (targetErr) return NextResponse.json({ ok: false, error: targetErr.message }, { status: 400 });
    if (!targetNode) return NextResponse.json({ ok: false, error: "Nodo no encontrado" }, { status: 404 });

    const { data: refNodes, error: refNodesErr } = await supabase
      .from("chat_flow_nodes")
      .select("node_code")
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", params.flowCode)
      .eq("next_node_code", targetCode)
      .neq("node_code", targetCode);
    if (refNodesErr) return NextResponse.json({ ok: false, error: refNodesErr.message }, { status: 400 });

    const { data: flowNodes, error: flowNodesErr } = await supabase
      .from("chat_flow_nodes")
      .select("id, node_code")
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", params.flowCode);
    if (flowNodesErr) return NextResponse.json({ ok: false, error: flowNodesErr.message }, { status: 400 });

    const flowNodeIds = new Set((flowNodes ?? []).map((n) => n.id as string));
    const idToCode = new Map((flowNodes ?? []).map((n) => [n.id as string, n.node_code as string]));

    const { data: refOpts, error: refOptsErr } = await supabase
      .from("chat_flow_options")
      .select("id, label, node_id")
      .eq("next_node_code", targetCode);
    if (refOptsErr) return NextResponse.json({ ok: false, error: refOptsErr.message }, { status: 400 });

    const fromOptions = (refOpts ?? [])
      .filter((o) => flowNodeIds.has(o.node_id as string))
      .map((o) => ({
        parent_node_code: idToCode.get(o.node_id as string) ?? String(o.node_id),
        label: String((o as { label?: string }).label ?? ""),
      }));

    const fromNodes = (refNodes ?? []).map((n) => ({ node_code: n.node_code as string }));

    if (fromNodes.length > 0 || fromOptions.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No se puede eliminar este paso: otros nodos u opciones de botón/lista apuntan a él. Cambiá esas referencias primero.",
          references: { fromNodes, fromOptions },
        },
        { status: 409 }
      );
    }

    const { error: delErr } = await supabase
      .from("chat_flow_nodes")
      .delete()
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", params.flowCode)
      .eq("node_code", targetCode);
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/nodes/:nodeCode][DELETE]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; nodeCode: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      node_type?: string;
      message_text?: string | null;
      save_as_field?: string | null;
      next_node_code?: string | null;
      sort_order?: number;
      is_active?: boolean;
      crm_action_type?: string | null;
      crm_action_config?: Record<string, unknown> | null;
      input_validation?: string | null;
      input_invalid_message?: string | null;
      capture_confirm_label?: string | null;
      input_max_value?: number | string | null;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.node_type === "string") {
      const nodeType = body.node_type.trim();
      if (!VALID_NODE_TYPES.includes(nodeType as (typeof VALID_NODE_TYPES)[number])) {
        return NextResponse.json({ ok: false, error: "node_type inválido" }, { status: 400 });
      }
      patch.node_type = nodeType;
    }
    if ("message_text" in body) patch.message_text = body.message_text ?? null;
    if ("save_as_field" in body) patch.save_as_field = body.save_as_field?.trim() || null;
    if ("next_node_code" in body) patch.next_node_code = body.next_node_code?.trim() || null;
    if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
      patch.sort_order = Math.max(1, Math.trunc(body.sort_order));
    }
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if ("input_validation" in body) {
      const v = (body.input_validation ?? "none").trim();
      if (v !== "none" && v !== "number" && v !== "title_case") {
        return NextResponse.json({ ok: false, error: "input_validation inválido" }, { status: 400 });
      }
      patch.input_validation = v;
    }
    if ("input_invalid_message" in body) {
      patch.input_invalid_message = body.input_invalid_message?.trim() || null;
    }
    if ("capture_confirm_label" in body) {
      patch.capture_confirm_label = body.capture_confirm_label?.trim().slice(0, 60) || null;
    }
    if ("input_max_value" in body) {
      const raw = body.input_max_value;
      if (raw === null || raw === "" || raw === undefined) {
        patch.input_max_value = null;
      } else {
        const n = Math.trunc(Number(raw));
        if (!Number.isFinite(n) || n < 1 || n > 100000) {
          return NextResponse.json({ ok: false, error: "input_max_value inválido" }, { status: 400 });
        }
        patch.input_max_value = n;
      }
    }
    if ("crm_action_type" in body) patch.crm_action_type = body.crm_action_type?.trim() || null;
    if ("crm_action_config" in body) {
      patch.crm_action_config =
        typeof body.crm_action_config === "object" && body.crm_action_config
          ? body.crm_action_config
          : {};
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const { data: currentNode, error: nodeErr } = await supabase
      .from("chat_flow_nodes")
      .select("id, node_type")
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", params.flowCode)
      .eq("node_code", params.nodeCode)
      .maybeSingle();
    if (nodeErr) return NextResponse.json({ ok: false, error: nodeErr.message }, { status: 400 });
    if (!currentNode) return NextResponse.json({ ok: false, error: "Nodo no encontrado" }, { status: 404 });

    const targetType = typeof patch.node_type === "string" ? patch.node_type : currentNode.node_type;
    if (targetType === "media") {
      const { data: mediaBlocks, error: blockErr } = await supabase
        .from("chat_flow_node_blocks")
        .select("media_url")
        .eq("empresa_id", auth.empresa_id)
        .eq("node_id", currentNode.id)
        .eq("block_type", "image")
        .order("sort_order", { ascending: true });
      if (blockErr) return NextResponse.json({ ok: false, error: blockErr.message }, { status: 400 });
      const hasAnyValidMediaUrl = (mediaBlocks ?? []).some((block) => {
        const mediaUrl = (block.media_url as string | null | undefined)?.trim() ?? "";
        return Boolean(mediaUrl) && isValidHttpUrl(mediaUrl);
      });
      if (!hasAnyValidMediaUrl) {
        return NextResponse.json(
          { ok: false, error: "Nodo media requiere un bloque de imagen con URL válida (http/https)." },
          { status: 400 }
        );
      }
    }

    const guardar = async (cambios: Record<string, unknown>) =>
      supabase
        .from("chat_flow_nodes")
        .update(cambios)
        .eq("empresa_id", auth.empresa_id)
        .eq("flow_code", params.flowCode)
        .eq("node_code", params.nodeCode)
        .select("id, node_code, node_type, message_text, save_as_field, next_node_code, sort_order, is_active, crm_action_type, crm_action_config, created_at")
        .maybeSingle();

    let { data, error } = await guardar(patch);
    if (error && markMissingFlowNodeColumns(error.message)) {
      /**
       * Base sin migrar: se guarda lo demás y se avisa, en vez de perder toda la edición
       * del paso por dos campos que todavía no existen.
       */
      const sinNuevas = { ...patch };
      delete sinNuevas.input_validation;
      delete sinNuevas.input_invalid_message;
      delete sinNuevas.capture_confirm_label;
      delete sinNuevas.input_max_value;
      ({ data, error } = await guardar(sinNuevas));
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "Nodo no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/nodes/:nodeCode][PATCH]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
