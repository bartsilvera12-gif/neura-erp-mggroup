"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getSorteos } from "@/lib/sorteos/actions";
import { optionPayloadFinalizesSorteoOrder } from "@/lib/sorteos/sorteo-option-payload";
import { computeFlowGraphWarnings } from "@/lib/chat/flow-graph-warnings";
import { FlowRecontactAutomationsPanel } from "./flow-recontact-automations-panel";
import { FlowNodeCard } from "./flow-node-card";
import { FlowSorteoPanel } from "./flow-sorteo-panel";
import {
  ChangeNextModal,
  InsertBetweenModal,
  type InsertDraft,
  type InsertModalState,
} from "./flow-editor-modals";
import {
  MAX_WHATSAPP_IMAGE_CAPTION,
  NODE_TYPE_OPTIONS,
  buildPayloadFromSimple,
  compareFlowNodes,
  friendlyNodeTitle,
  isValidHttpUrl,
  mergeSavedFlowOption,
  mergeServerNodesPreservingDirty,
  nodePickerLabel,
  prettifyCode,
  resolveUniqueMetaButtonId,
  stringifyOptionPayload,
  stripSorteoFinalizeKeys,
  toSimpleDraftFromPayload,
  validateButtonsQuickReplyGroups,
  visibleBlocksForEditor,
} from "./flow-editor-helpers";
import type {
  FlowNode,
  FlowNodeBlock,
  FlowNodeOption,
  FlowOptionCreateContext,
  OptionSimpleDraft,
} from "./flow-editor-types";

const EMPTY_INSERT_DRAFT: InsertDraft = {
  node_code: "",
  node_type: "text",
  message_text: "",
  save_as_field: "",
};

export default function FlowEditorPage() {
  const params = useParams<{ flowCode: string }>();
  const flowCode = decodeURIComponent(params?.flowCode ?? "");

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  /** Lectura síncrona del último estado al guardar (evita `liveOpt.label` stale si el clic corre antes del re-render). */
  const nodesRef = useRef<FlowNode[]>([]);
  nodesRef.current = nodes;

  /** Pasos con ediciones locales todavía sin guardar; `reload()` no los pisa. */
  const [dirtyNodeIds, setDirtyNodeIds] = useState<Set<string>>(() => new Set());
  const dirtyRef = useRef<Set<string>>(dirtyNodeIds);
  dirtyRef.current = dirtyNodeIds;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newNodeCode, setNewNodeCode] = useState("");
  const [newNodeType, setNewNodeType] = useState("text");
  const [creatingNode, setCreatingNode] = useState(false);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const [togglingActiveNodeId, setTogglingActiveNodeId] = useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  /** Varios pasos pueden estar abiertos a la vez: abrir uno ya no cierra el que estabas mirando. */
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [nodeQuery, setNodeQuery] = useState("");
  const [optionPayloadDrafts, setOptionPayloadDrafts] = useState<Record<string, string>>({});
  const [optionEditorMode, setOptionEditorMode] = useState<Record<string, "simple" | "advanced">>({});
  const [optionSimpleDrafts, setOptionSimpleDrafts] = useState<Record<string, OptionSimpleDraft>>({});
  const [optionSaveError, setOptionSaveError] = useState<Record<string, string>>({});
  /** Botón que solo cierra la compra sorteo (no redefine oferta). */
  const [optionFinalizeSorteo, setOptionFinalizeSorteo] = useState<Record<string, boolean>>({});
  const [sorteosOptions, setSorteosOptions] = useState<{ id: string; nombre: string }[]>([]);
  const [flowSorteoId, setFlowSorteoId] = useState<string | null>(null);
  const [flowSorteoNombre, setFlowSorteoNombre] = useState<string | null>(null);
  const [sorteoDraft, setSorteoDraft] = useState<string>("");
  const [savingSorteoLink, setSavingSorteoLink] = useState(false);
  const [sorteoIncompleteMsgDraft, setSorteoIncompleteMsgDraft] = useState("");
  const [savingSorteoIncompleteMsg, setSavingSorteoIncompleteMsg] = useState(false);
  /** Evita pantalla completa «Cargando pasos…» en acciones rápidas (p. ej. crear bloque imagen). */
  const [creatingBlockKey, setCreatingBlockKey] = useState<string | null>(null);

  const [insertModal, setInsertModal] = useState<InsertModalState | null>(null);
  const [insertDraft, setInsertDraft] = useState<InsertDraft>(EMPTY_INSERT_DRAFT);
  const [insertBusy, setInsertBusy] = useState(false);

  const [changeNextModal, setChangeNextModal] = useState<
    null | { kind: "node"; nodeId: string } | { kind: "option"; nodeId: string; optionId: string }
  >(null);
  const [changeNextValue, setChangeNextValue] = useState("");
  const [changeNextBusy, setChangeNextBusy] = useState(false);

  const [editorTab, setEditorTab] = useState<"pasos" | "automatizaciones">("pasos");

  const orderedNodes = useMemo(() => [...nodes].sort(compareFlowNodes), [nodes]);
  const nodeByCode = useMemo(() => new Map(orderedNodes.map((n) => [n.node_code, n])), [orderedNodes]);

  const nodePickerOptions = useMemo(
    () => orderedNodes.map((n) => ({ node_code: n.node_code, label: nodePickerLabel(n) })),
    [orderedNodes]
  );

  const graphWarnings = useMemo(
    () =>
      computeFlowGraphWarnings(
        orderedNodes.map((n) => ({
          node_code: n.node_code,
          node_type: n.node_type,
          next_node_code: n.next_node_code,
          options: n.options.map((o) => ({
            id: o.id,
            label: o.label,
            next_node_code: o.next_node_code,
          })),
        }))
      ),
    [orderedNodes]
  );

  const incomingConnections = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of orderedNodes) {
      if (n.next_node_code) {
        const list = map.get(n.next_node_code) ?? [];
        list.push(`${prettifyCode(n.node_code)} (siguiente)`);
        map.set(n.next_node_code, list);
      }
      for (const opt of n.options) {
        if (!opt.next_node_code) continue;
        const list = map.get(opt.next_node_code) ?? [];
        list.push(`${prettifyCode(n.node_code)} > ${opt.label}`);
        map.set(opt.next_node_code, list);
      }
    }
    return map;
  }, [orderedNodes]);

  const visibleNodes = useMemo(() => {
    const q = nodeQuery.trim().toLowerCase();
    const withIndex = orderedNodes.map((node, index) => ({ node, index }));
    if (!q) return withIndex;
    return withIndex.filter(
      ({ node }) =>
        node.node_code.toLowerCase().includes(q) ||
        (node.message_text ?? "").toLowerCase().includes(q) ||
        node.options.some((o) => o.label.toLowerCase().includes(q))
    );
  }, [orderedNodes, nodeQuery]);

  function nextStepLabel(nextNodeCode: string | null): string {
    if (!nextNodeCode) return "Sin siguiente paso";
    const target = nodeByCode.get(nextNodeCode);
    if (!target) return `${prettifyCode(nextNodeCode)} (pendiente crear)`;
    return friendlyNodeTitle(target);
  }

  /** Destinos posibles para un paso: todos menos él mismo (elegirse a sí mismo crea un bucle). */
  function pickerItemsExcluding(nodeCode: string) {
    return nodePickerOptions.filter((item) => item.node_code !== nodeCode);
  }

  function blockBusyKey(nodeId: string, blockType: FlowNodeBlock["block_type"]) {
    return `${nodeId}:${blockType}`;
  }

  /** El ref se actualiza en el acto: `reload()` puede correr antes del próximo render. */
  function markDirty(nodeId: string) {
    if (!dirtyRef.current.has(nodeId)) {
      dirtyRef.current = new Set(dirtyRef.current).add(nodeId);
    }
    setDirtyNodeIds((prev) => {
      if (prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }

  function clearDirty(nodeId: string) {
    if (dirtyRef.current.has(nodeId)) {
      const nextRef = new Set(dirtyRef.current);
      nextRef.delete(nodeId);
      dirtyRef.current = nextRef;
    }
    setDirtyNodeIds((prev) => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }

  const reload = useCallback(
    async (opts?: { soft?: boolean }): Promise<FlowNode[]> => {
      const fullScreen = opts?.soft !== true;
      if (fullScreen) setLoading(true);
      try {
        const res = await fetchWithSupabaseSession(`/api/chat/flows/${encodeURIComponent(flowCode)}/nodes`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          items?: FlowNode[];
        };
        if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo cargar los pasos");
        const items = json.items ?? [];
        const merged = mergeServerNodesPreservingDirty(items, nodesRef.current, dirtyRef.current);
        setNodes(merged);
        /** Tras cada GET, alinear borradores con servidor (antes solo se inicializaba si faltaba la clave → estado viejo). */
        setOptionPayloadDrafts(() => {
          const next: Record<string, string> = {};
          for (const node of merged) {
            for (const option of node.options ?? []) {
              next[option.id] = stringifyOptionPayload(option.option_payload);
            }
          }
          return next;
        });
        setOptionSimpleDrafts(() => {
          const next: Record<string, OptionSimpleDraft> = {};
          for (const node of merged) {
            for (const option of node.options ?? []) {
              next[option.id] = toSimpleDraftFromPayload(option);
            }
          }
          return next;
        });
        setOptionEditorMode((prev) => {
          const next = { ...prev };
          for (const node of merged) {
            for (const option of node.options ?? []) {
              if (!next[option.id]) next[option.id] = "simple";
            }
          }
          return next;
        });
        /**
         * Solo inicializa las opciones que todavía no tienen valor local: recalcularlas todas
         * borraba el tilde recién marcado en cuanto cualquier acción disparaba un reload.
         */
        setOptionFinalizeSorteo((prev) => {
          const next = { ...prev };
          for (const node of merged) {
            for (const option of node.options ?? []) {
              if (next[option.id] === undefined) {
                next[option.id] = optionPayloadFinalizesSorteoOrder(option.option_payload);
              }
            }
          }
          return next;
        });
        setError(null);
        return merged;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cargar");
        return [];
      } finally {
        if (fullScreen) setLoading(false);
      }
    },
    [flowCode]
  );

  useEffect(() => {
    void reload();
    void (async () => {
      try {
        const [sorteosRows, flowRes] = await Promise.all([
          getSorteos().catch(() => []),
          fetchWithSupabaseSession(`/api/chat/flows/${encodeURIComponent(flowCode)}`, {
            credentials: "same-origin",
            cache: "no-store",
          }).then((r) => r.json()),
        ]);
        setSorteosOptions(sorteosRows.map((s) => ({ id: s.id, nombre: s.nombre })));
        const fj = flowRes as {
          ok?: boolean;
          item?: {
            sorteo_id?: string | null;
            sorteo_nombre?: string | null;
            sorteo_datos_incompletos_message?: string | null;
          };
        };
        if (fj.ok && fj.item) {
          setFlowSorteoId(fj.item.sorteo_id ?? null);
          setFlowSorteoNombre(fj.item.sorteo_nombre ?? null);
          setSorteoDraft(fj.item.sorteo_id ?? "");
          setSorteoIncompleteMsgDraft(fj.item.sorteo_datos_incompletos_message ?? "");
        }
      } catch {
        setSorteosOptions([]);
      }
    })();
  }, [flowCode, reload]);

  /** El cartel verde antes quedaba pegado para siempre; se limpia solo. */
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(t);
  }, [success]);

  /** Aviso del navegador si se intenta salir con pasos a medio editar. */
  useEffect(() => {
    if (dirtyNodeIds.size === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyNodeIds]);

  // --- Mutaciones locales (marcan el paso como sucio) ---

  function patchNode(nodeId: string, patch: Partial<FlowNode>) {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
    markDirty(nodeId);
  }

  function patchBlock(nodeId: string, blockId: string, patch: Partial<FlowNodeBlock>) {
    setNodes((prev) =>
      prev.map((n) =>
        n.id !== nodeId ? n : { ...n, blocks: n.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
      )
    );
    markDirty(nodeId);
  }

  function patchOption(nodeId: string, optionId: string, patch: Partial<FlowNodeOption>) {
    setOptionSaveError((prev) => {
      if (!prev[optionId]) return prev;
      const next = { ...prev };
      delete next[optionId];
      return next;
    });
    setNodes((prev) =>
      prev.map((n) =>
        n.id !== nodeId ? n : { ...n, options: n.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
      )
    );
    markDirty(nodeId);
  }

  function setSimpleDraft(option: FlowNodeOption, patch: Partial<OptionSimpleDraft>) {
    setOptionSimpleDrafts((prev) => ({
      ...prev,
      [option.id]: { ...(prev[option.id] ?? toSimpleDraftFromPayload(option)), ...patch },
    }));
  }

  // --- Sorteo del flujo ---

  async function saveSorteoAssociation() {
    setSavingSorteoLink(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/chat/flows/${encodeURIComponent(flowCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sorteo_id: sorteoDraft.trim() || null }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item?: { sorteo_id?: string | null; sorteo_nombre?: string | null };
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar la asociación");
      const item = json.item;
      if (item) {
        setFlowSorteoId(item.sorteo_id ?? null);
        setFlowSorteoNombre(item.sorteo_nombre ?? null);
      }
      setSuccess("Sorteo asociado guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar sorteo");
    } finally {
      setSavingSorteoLink(false);
    }
  }

  async function saveSorteoIncompleteMessage() {
    setSavingSorteoIncompleteMsg(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/chat/flows/${encodeURIComponent(flowCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          sorteo_datos_incompletos_message: sorteoIncompleteMsgDraft.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item?: { sorteo_datos_incompletos_message?: string | null };
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar el mensaje");
      if (json.item?.sorteo_datos_incompletos_message != null) {
        setSorteoIncompleteMsgDraft(json.item.sorteo_datos_incompletos_message);
      }
      setSuccess("Mensaje de datos incompletos guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar mensaje");
    } finally {
      setSavingSorteoIncompleteMsg(false);
    }
  }

  // --- Pasos ---

  async function createNode(e: React.FormEvent) {
    e.preventDefault();
    const trimmedCode = newNodeCode.trim();
    if (!trimmedCode) {
      setError("Escribí el nombre del paso (código interno) antes de crearlo.");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedCode)) {
      setError("El código del paso solo puede tener letras, números, guion y guion bajo.");
      return;
    }
    if (nodeByCode.has(trimmedCode)) {
      setError(`Ya existe un paso con el código «${trimmedCode}». Elegí otro.`);
      return;
    }
    setError(null);
    setSuccess(null);
    setCreatingNode(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/chat/flows/${encodeURIComponent(flowCode)}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ node_code: trimmedCode, node_type: newNodeType, message_text: "" }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear el paso");
      setNewNodeCode("");
      const reloaded = await reload();
      const created = reloaded.find((n) => n.node_code === trimmedCode);
      if (created) setExpandedNodeIds((prev) => new Set(prev).add(created.id));
      setSuccess(`Paso ${prettifyCode(trimmedCode)} creado.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando el paso");
    } finally {
      setCreatingNode(false);
    }
  }

  async function saveNodeCore(node: FlowNode) {
    setError(null);
    if (node.node_type === "media") {
      const mediaBlock = node.blocks.find((b) => b.block_type === "image");
      const mediaUrl = mediaBlock?.media_url?.trim() ?? "";
      const captionSize = (mediaBlock?.content_text ?? "").trim().length;
      if (!mediaBlock) {
        throw new Error("Este paso requiere configurar una imagen antes de guardar.");
      }
      if (!mediaUrl || !isValidHttpUrl(mediaUrl)) {
        throw new Error("El paso 'Mensaje con imagen' requiere una URL válida de imagen.");
      }
      if (captionSize > MAX_WHATSAPP_IMAGE_CAPTION) {
        throw new Error(`El caption supera ${MAX_WHATSAPP_IMAGE_CAPTION} caracteres.`);
      }
      // UX: guardar el bloque media junto con el paso para evitar errores por cambios no persistidos.
      await saveBlockCore(node, mediaBlock);
    }
    const res = await fetchWithSupabaseSession(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          node_type: node.node_type,
          message_text: node.message_text ?? "",
          save_as_field: node.save_as_field ?? null,
          next_node_code: node.next_node_code ?? null,
          is_active: node.is_active,
          crm_action_type: node.crm_action_type ?? null,
          crm_action_config: node.crm_action_config ?? {},
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar el paso");

    /** Sin esto, quien usa solo «Guardar paso» nunca mandaba PATCH de opciones → el texto del botón no persistía en BD. */
    const snap = nodesRef.current.find((n) => n.id === node.id);
    if (snap && snap.node_type === "buttons") {
      const gErr = validateButtonsQuickReplyGroups(snap);
      if (gErr) throw new Error(gErr);
    }
    if (snap && (snap.node_type === "buttons" || snap.node_type === "list") && snap.options.length > 0) {
      /**
       * Antes cortaba en la primera opción con error y dejaba el resto sin guardar.
       * Ahora se intentan todas y se informa juntas las que fallaron.
       */
      const failed: string[] = [];
      for (const o of snap.options) {
        try {
          await persistOptionCore(snap, o, { toastSuccess: false, reason: "save_node_batch" });
        } catch (e) {
          failed.push(`«${o.label || o.meta_button_id}»: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      if (failed.length > 0) {
        throw new Error(
          `El paso se guardó, pero estas opciones no:\n${failed.map((f) => `• ${f}`).join("\n")}`
        );
      }
    }
  }

  async function handleSaveNode(node: FlowNode) {
    setSavingNodeId(node.id);
    try {
      await saveNodeCore(node);
      clearDirty(node.id);
      await reload({ soft: true });
      setSuccess(`Paso ${prettifyCode(node.node_code)} guardado correctamente.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar el paso");
    } finally {
      setSavingNodeId(null);
    }
  }

  /**
   * «Activo» se guarda al instante: el checkbox vive en la cabecera, donde no hay botón de
   * guardar a la vista, y antes el cambio se perdía en el siguiente reload sin ningún aviso.
   */
  async function handleToggleActive(node: FlowNode, isActive: boolean) {
    const previous = node.is_active;
    setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, is_active: isActive } : n)));
    setTogglingActiveNodeId(node.id);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ is_active: isActive }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo cambiar el estado del paso");
      setSuccess(`Paso ${prettifyCode(node.node_code)} ${isActive ? "activado" : "desactivado"}.`);
    } catch (e) {
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, is_active: previous } : n)));
      setError(e instanceof Error ? e.message : "Error al cambiar el estado del paso");
    } finally {
      setTogglingActiveNodeId(null);
    }
  }

  function handleToggleExpand(node: FlowNode) {
    const closing = expandedNodeIds.has(node.id);
    if (closing && dirtyNodeIds.has(node.id)) {
      const ok = globalThis.confirm(
        `El paso «${node.node_code}» tiene cambios sin guardar. ¿Cerrar y descartarlos?`
      );
      if (!ok) return;
      clearDirty(node.id);
      void reload({ soft: true });
    }
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (closing) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function handleDiscardChanges(node: FlowNode) {
    if (!globalThis.confirm(`¿Descartar los cambios sin guardar del paso «${node.node_code}»?`)) return;
    clearDirty(node.id);
    void reload({ soft: true });
    setSuccess("Cambios descartados.");
  }

  async function deleteNode(node: FlowNode) {
    if (
      !globalThis.confirm(
        `¿Eliminar el paso «${node.node_code}»? Las opciones y bloques de este paso se borrarán. No se puede deshacer.`
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    setDeletingNodeId(node.id);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        references?: {
          fromNodes?: { node_code: string }[];
          fromOptions?: { parent_node_code: string; label: string }[];
        };
      };
      if (res.status === 409 && json.references) {
        const parts: string[] = [json.error ?? "Hay referencias a este paso."];
        for (const r of json.references.fromNodes ?? []) {
          parts.push(`• Paso «${r.node_code}» lo tiene como siguiente paso.`);
        }
        for (const r of json.references.fromOptions ?? []) {
          parts.push(`• Botón/lista «${r.label}» en «${r.parent_node_code}» apunta a este paso.`);
        }
        setError(parts.join("\n"));
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo eliminar el paso");
      setExpandedNodeIds((prev) => {
        if (!prev.has(node.id)) return prev;
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      clearDirty(node.id);
      setSuccess(`Paso «${node.node_code}» eliminado.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar el paso");
    } finally {
      setDeletingNodeId(null);
    }
  }

  async function applyNodeReorder(dragId: string, targetId: string) {
    if (dragId === targetId) return;
    const sorted = [...nodes].sort(compareFlowNodes);
    const from = sorted.findIndex((n) => n.id === dragId);
    const to = sorted.findIndex((n) => n.id === targetId);
    if (from < 0 || to < 0) return;
    const nextOrder = [...sorted];
    const [moved] = nextOrder.splice(from, 1);
    nextOrder.splice(to, 0, moved);

    setReorderBusy(true);
    setError(null);
    setSuccess(null);
    try {
      for (let i = 0; i < nextOrder.length; i++) {
        const n = nextOrder[i];
        const sortOrder = i + 1;
        if (n.sort_order === sortOrder) continue;
        const res = await fetchWithSupabaseSession(
          `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(n.node_code)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ sort_order: sortOrder }),
          }
        );
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar el orden");
      }
      setSuccess("Orden de pasos actualizado (solo visual; los enlaces del flujo no cambian).");
      await reload({ soft: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al reordenar");
      await reload({ soft: true });
    } finally {
      setReorderBusy(false);
    }
  }

  // --- Opciones ---

  /**
   * Persiste una opción (label, payload, siguiente paso). Usado desde «Guardar opción» y desde «Guardar paso» en lote.
   */
  async function persistOptionCore(
    live: FlowNode,
    liveOpt: FlowNodeOption,
    opts: { toastSuccess: boolean; reason?: string }
  ) {
    const nextCode = liveOpt.next_node_code?.trim() || null;
    if ((live.node_type === "buttons" || live.node_type === "list") && !nextCode) {
      const msg =
        "Elegí un paso destino en «Al tocarlo va a» antes de guardar. Sin siguiente paso el botón no puede continuar el flujo.";
      setOptionSaveError((prev) => ({ ...prev, [liveOpt.id]: msg }));
      throw new Error(msg);
    }
    setOptionSaveError((prev) => {
      const next = { ...prev };
      delete next[liveOpt.id];
      return next;
    });
    const mode = optionEditorMode[liveOpt.id] ?? "simple";
    const finalizeOn = Boolean(flowSorteoId && optionFinalizeSorteo[liveOpt.id]);

    let payloadParsed: Record<string, unknown> = {};
    if (mode === "advanced") {
      const payloadDraft = optionPayloadDrafts[liveOpt.id] ?? stringifyOptionPayload(liveOpt.option_payload);
      try {
        const parsed = JSON.parse(payloadDraft) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("El payload debe ser un objeto JSON");
        }
        const base = stripSorteoFinalizeKeys(parsed as Record<string, unknown>);
        payloadParsed = finalizeOn ? { ...base, confirmar_orden_sorteo: true } : base;
      } catch {
        throw new Error("Variables JSON inválidas para esta opción.");
      }
    } else if (finalizeOn) {
      payloadParsed = { confirmar_orden_sorteo: true };
      setOptionPayloadDrafts((prev) => ({ ...prev, [liveOpt.id]: stringifyOptionPayload(payloadParsed) }));
    } else {
      const draft = optionSimpleDrafts[liveOpt.id] ?? toSimpleDraftFromPayload(liveOpt);
      payloadParsed = stripSorteoFinalizeKeys(buildPayloadFromSimple(liveOpt.option_payload, draft));
      setOptionPayloadDrafts((prev) => ({ ...prev, [liveOpt.id]: stringifyOptionPayload(payloadParsed) }));
    }

    const buttonLabel = liveOpt.label.trim().slice(0, 500);
    if (!buttonLabel) {
      throw new Error('Completá «Texto del botón» (o texto de la opción en lista) antes de guardar.');
    }

    const metaButtonId = resolveUniqueMetaButtonId(live, liveOpt.id, buttonLabel);

    const refNode = nodesRef.current.find((n) => n.id === live.id) ?? live;
    const mergedOptionsForValidate = refNode.options.map((o) => {
      if (o.id !== liveOpt.id) return o;
      return {
        ...o,
        label: buttonLabel,
        meta_button_id: metaButtonId,
        next_node_code: nextCode,
        sort_order: liveOpt.sort_order,
        group_title: liveOpt.group_title ?? null,
        group_order: liveOpt.group_order ?? 0,
        option_payload: payloadParsed,
      };
    });
    const groupValErr = validateButtonsQuickReplyGroups({ ...refNode, options: mergedOptionsForValidate });
    if (groupValErr) {
      setOptionSaveError((prev) => ({ ...prev, [liveOpt.id]: groupValErr }));
      throw new Error(groupValErr);
    }

    const patchBody = {
      label: buttonLabel,
      meta_button_id: metaButtonId,
      next_node_code: nextCode,
      sort_order: liveOpt.sort_order,
      option_payload: payloadParsed,
      ...(live.node_type === "buttons"
        ? {
            group_title: (liveOpt.group_title ?? "").trim() || null,
            group_order: Math.trunc(Number(liveOpt.group_order ?? 0)),
          }
        : {}),
    };
    console.info("[flow-save]", "patch_chat_flow_option", {
      flowCode,
      node_code: live.node_code,
      option_id: liveOpt.id,
      reason: opts.reason ?? "single_option",
      body: patchBody,
    });
    const res = await fetchWithSupabaseSession(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(live.node_code)}/options/${liveOpt.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(patchBody),
      }
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      item?: FlowNodeOption;
    };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar la opción");
    if (json.item?.id === liveOpt.id) {
      const incoming = json.item as Partial<FlowNodeOption>;
      const mergedAfterSave = mergeSavedFlowOption(liveOpt, incoming);
      setNodes((prev) =>
        prev.map((n) =>
          n.id !== live.id
            ? n
            : {
                ...n,
                options: n.options.map((o) => (o.id === liveOpt.id ? mergeSavedFlowOption(o, incoming) : o)),
              }
        )
      );
      setOptionSimpleDrafts((prev) => ({
        ...prev,
        [liveOpt.id]: toSimpleDraftFromPayload(mergedAfterSave),
      }));
    }
    setError(null);
    if (opts.toastSuccess) {
      setSuccess(`Botón "${buttonLabel}" guardado.`);
    }
  }

  async function handleSaveOption(node: FlowNode, opt: FlowNodeOption) {
    setSuccess(null);
    try {
      const live = nodesRef.current.find((n) => n.id === node.id);
      const liveOpt = live?.options.find((o) => o.id === opt.id);
      if (!live || !liveOpt) {
        throw new Error("No se encontró la opción en el editor. Recargá la página.");
      }
      await persistOptionCore(live, liveOpt, { toastSuccess: true, reason: "guardar_opcion" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar la opción";
      setError(msg);
      setOptionSaveError((prev) => ({ ...prev, [opt.id]: msg }));
    }
  }

  async function createOptionCore(node: FlowNode, ctx: FlowOptionCreateContext = { kind: "default" }) {
    const live = nodesRef.current.find((n) => n.id === node.id) ?? node;

    if (live.node_type === "list" && live.options.length >= 10) {
      throw new Error(
        "WhatsApp admite como máximo 10 filas en mensaje de lista. Eliminá una opción antes de agregar otra."
      );
    }
    if (live.node_type === "buttons" && live.options.length >= 30) {
      throw new Error(
        "Límite de 30 opciones por paso de botones. Si usás grupos, cada burbuja lleva hasta 3 botones rápidos."
      );
    }

    const maxGlobalSort = live.options.reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0);

    let sortOrder = maxGlobalSort + 1;
    let nextNodeCode: string | null = null;
    let groupTitleOut: string | null | undefined = undefined;
    let groupOrderOut: number | undefined = undefined;

    if (ctx.kind === "in_group") {
      const anchor = live.options.find((o) => o.id === ctx.anchorOptionId);
      if (!anchor) throw new Error("No se encontró la opción de referencia del grupo.");
      const gt = (anchor.group_title ?? "").trim();
      const go = anchor.group_order ?? 0;
      const peers = live.options.filter(
        (o) => (o.group_order ?? 0) === go && (o.group_title ?? "").trim() === gt
      );
      const maxPeer = peers.reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0);
      sortOrder = Math.max(maxGlobalSort + 1, maxPeer + 1);
      nextNodeCode = anchor.next_node_code?.trim() || null;
      groupTitleOut = gt.length ? anchor.group_title ?? null : null;
      groupOrderOut = go;
    } else if (ctx.kind === "new_group") {
      const maxGo = live.options.reduce((m, o) => Math.max(m, o.group_order ?? 0), 0);
      groupTitleOut = "Nuevo grupo";
      groupOrderOut = maxGo + 1;
      nextNodeCode = null;
      sortOrder = maxGlobalSort + 1;
    } else if (ctx.kind === "ungrouped") {
      groupTitleOut = null;
      groupOrderOut = 0;
      nextNodeCode = null;
      sortOrder = maxGlobalSort + 1;
    } else {
      nextNodeCode = null;
      sortOrder = maxGlobalSort + 1;
    }

    const uniqueSuffix =
      typeof globalThis.crypto !== "undefined" && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : `${Date.now().toString(36)}`;
    const metaButtonId = `opt_${sortOrder}_${uniqueSuffix}`;
    const label =
      ctx.kind === "new_group" ? "Nuevo botón" : sortOrder <= 1 ? "Nueva opción" : `Nueva opción ${sortOrder}`;

    const body: Record<string, unknown> = {
      label,
      meta_button_id: metaButtonId,
      next_node_code: nextNodeCode,
      sort_order: sortOrder,
      option_payload: {},
    };
    if (ctx.kind === "in_group" || ctx.kind === "new_group") {
      body.group_title = groupTitleOut ?? null;
      body.group_order = groupOrderOut ?? 0;
    } else if (ctx.kind === "ungrouped") {
      body.group_title = null;
      body.group_order = 0;
    }

    const res = await fetchWithSupabaseSession(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(live.node_code)}/options`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear la opción");
    setSuccess(`Opción creada en ${prettifyCode(live.node_code)}.`);
  }

  async function handleCreateOption(node: FlowNode, ctx: FlowOptionCreateContext = { kind: "default" }) {
    try {
      await createOptionCore(node, ctx);
      await reload({ soft: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear la opción");
    }
  }

  async function handleDeleteOption(node: FlowNode, opt: FlowNodeOption) {
    if (
      !globalThis.confirm(
        `¿Eliminar ${node.node_type === "list" ? "la opción" : "el botón"} «${
          opt.label || "(sin texto)"
        }»? No se puede deshacer.`
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(
          node.node_code
        )}/options/${encodeURIComponent(opt.id)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      const raw = await res.text();
      let json = {} as { ok?: boolean; error?: string };
      try {
        json = raw ? (JSON.parse(raw) as typeof json) : {};
      } catch {
        throw new Error(raw.trim().slice(0, 220) || `HTTP ${res.status}`);
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `No se pudo eliminar la opción (HTTP ${res.status}).`);
      }
      const dropKey = <T,>(prev: Record<string, T>): Record<string, T> => {
        const next = { ...prev };
        delete next[opt.id];
        return next;
      };
      setOptionSimpleDrafts(dropKey);
      setOptionPayloadDrafts(dropKey);
      setOptionEditorMode(dropKey);
      setOptionFinalizeSorteo(dropKey);
      setSuccess("Opción eliminada.");
      await reload({ soft: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar la opción");
    }
  }

  // --- Bloques ---

  async function saveBlockCore(node: FlowNode, block: FlowNodeBlock) {
    const res = await fetchWithSupabaseSession(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/blocks/${block.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          block_type: block.block_type,
          content_text: block.content_text,
          media_url: block.media_url,
          sort_order: block.sort_order,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar el bloque");
  }

  async function handleCreateBlock(node: FlowNode, blockType: FlowNodeBlock["block_type"]) {
    const busy = blockBusyKey(node.id, blockType);
    setError(null);
    setCreatingBlockKey(busy);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/blocks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            block_type: blockType,
            content_text: blockType === "text" ? "Nuevo texto" : blockType === "buttons" ? "Elegí una opción" : null,
            media_url: null,
            sort_order: node.blocks.length + 1,
          }),
        }
      );
      const raw = await res.text();
      let json: { ok?: boolean; error?: string; item?: FlowNodeBlock } = {};
      try {
        json = raw ? (JSON.parse(raw) as typeof json) : {};
      } catch {
        throw new Error(raw.trim().slice(0, 280) || `Respuesta inválida del servidor (HTTP ${res.status}).`);
      }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `No se pudo crear el bloque (HTTP ${res.status}).`);
      await reload({ soft: true });
      if (blockType === "image" && node.node_type === "media") {
        setSuccess("Podés pegar la URL, subir un archivo o escribir el texto debajo de la imagen.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear el bloque");
    } finally {
      setCreatingBlockKey((k) => (k === busy ? null : k));
    }
  }

  async function handleSaveBlock(node: FlowNode, blockId: string) {
    try {
      const latestNode = nodesRef.current.find((n) => n.id === node.id);
      const latestBlock = latestNode?.blocks.find((b) => b.id === blockId);
      if (!latestNode || !latestBlock) return;
      if (latestBlock.block_type === "image") {
        const mediaUrl = latestBlock.media_url?.trim() ?? "";
        const caption = latestBlock.content_text?.trim() ?? "";
        if (mediaUrl && !isValidHttpUrl(mediaUrl)) {
          throw new Error("La URL de imagen debe ser http/https.");
        }
        if (caption.length > MAX_WHATSAPP_IMAGE_CAPTION) {
          throw new Error(`El caption supera ${MAX_WHATSAPP_IMAGE_CAPTION} caracteres.`);
        }
      }
      await saveBlockCore(latestNode, latestBlock);
      setSuccess("Bloque guardado.");
      await reload({ soft: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar el bloque");
    }
  }

  /**
   * Mueve un bloque usando la misma lista ordenada que se ve en pantalla; antes se indexaba
   * sobre `node.blocks` sin ordenar, así que el ↑/↓ podía intercambiar el bloque equivocado.
   */
  async function handleMoveBlock(node: FlowNode, blockId: string, direction: -1 | 1) {
    try {
      const latestNode = nodesRef.current.find((n) => n.id === node.id);
      if (!latestNode) return;
      const ordered = visibleBlocksForEditor(latestNode);
      const idx = ordered.findIndex((b) => b.id === blockId);
      const swapWith = ordered[idx + direction];
      if (idx < 0 || !swapWith) return;
      const current = ordered[idx];
      await saveBlockCore(latestNode, { ...current, sort_order: swapWith.sort_order });
      await saveBlockCore(latestNode, { ...swapWith, sort_order: current.sort_order });
      await reload({ soft: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al reordenar los bloques");
    }
  }

  async function handleDeleteBlock(node: FlowNode, blockId: string) {
    if (!globalThis.confirm("¿Eliminar este bloque del mensaje? No se puede deshacer.")) return;
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/blocks/${blockId}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo eliminar el bloque");
      setSuccess("Bloque eliminado.");
      await reload({ soft: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar el bloque");
    }
  }

  async function uploadImage(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetchWithSupabaseSession("/api/chat/flow-media/upload", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; media_url?: string };
    if (!res.ok || !json.ok || !json.media_url) throw new Error(json.error ?? "No se pudo subir la imagen");
    return json.media_url;
  }

  // --- Modales del grafo ---

  function openInsertForNode(node: FlowNode) {
    setInsertDraft(EMPTY_INSERT_DRAFT);
    setInsertModal({ sourceType: "node", sourceNodeCode: node.node_code });
  }

  function openInsertForOption(node: FlowNode, opt: FlowNodeOption) {
    setInsertDraft(EMPTY_INSERT_DRAFT);
    setInsertModal({
      sourceType: "option",
      sourceNodeCode: node.node_code,
      sourceOptionId: opt.id,
      optionLabel: opt.label,
    });
  }

  async function submitInsertBetween() {
    if (!insertModal) return;
    const trimmedCode = insertDraft.node_code.trim();
    if (!trimmedCode) {
      setError("Escribí el código interno del nuevo paso.");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedCode)) {
      setError("El código solo puede tener letras, números, guion y guion bajo.");
      return;
    }
    setInsertBusy(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/insert-between`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            sourceType: insertModal.sourceType,
            sourceNodeCode: insertModal.sourceNodeCode,
            sourceOptionId: insertModal.sourceOptionId,
            newNode: {
              node_code: trimmedCode,
              node_type: insertDraft.node_type,
              message_text: insertDraft.message_text.trim() || null,
              save_as_field: insertDraft.save_as_field.trim() || null,
            },
          }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo insertar el paso");
      setInsertModal(null);
      setInsertDraft(EMPTY_INSERT_DRAFT);
      await reload({ soft: true });
      setSuccess(`Paso «${prettifyCode(trimmedCode)}» insertado y enlazado en el grafo.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al insertar el paso");
    } finally {
      setInsertBusy(false);
    }
  }

  function openChangeNextForNode(node: FlowNode) {
    setChangeNextValue(node.next_node_code ?? "");
    setChangeNextModal({ kind: "node", nodeId: node.id });
  }

  function openChangeNextForOption(node: FlowNode, opt: FlowNodeOption) {
    setChangeNextValue(opt.next_node_code ?? "");
    setChangeNextModal({ kind: "option", nodeId: node.id, optionId: opt.id });
  }

  async function patchNodeNextCodeOnly(node: FlowNode, nextCode: string | null) {
    const res = await fetchWithSupabaseSession(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ next_node_code: nextCode }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo actualizar el siguiente paso");
  }

  async function applyChangeNextModal() {
    if (!changeNextModal) return;
    const nextTrim = changeNextValue.trim();
    const nextCode = nextTrim.length === 0 ? null : nextTrim;
    setChangeNextBusy(true);
    setError(null);
    try {
      const node = nodes.find((n) => n.id === changeNextModal.nodeId);
      if (!node) throw new Error("Paso no encontrado");
      if (changeNextModal.kind === "node") {
        await patchNodeNextCodeOnly(node, nextCode);
      } else {
        const opt = node.options.find((o) => o.id === changeNextModal.optionId);
        if (!opt) throw new Error("Opción no encontrada");
        if ((node.node_type === "buttons" || node.node_type === "list") && !nextCode) {
          throw new Error("Elegí un destino para esta opción.");
        }
        const patchedOpt: FlowNodeOption = { ...opt, next_node_code: nextCode };
        const liveNode: FlowNode = {
          ...node,
          options: node.options.map((o) => (o.id === opt.id ? patchedOpt : o)),
        };
        await persistOptionCore(liveNode, patchedOpt, {
          toastSuccess: false,
          reason: "change_next_modal",
        });
      }
      setChangeNextModal(null);
      await reload({ soft: true });
      setSuccess("Destino actualizado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cambiar el destino");
    } finally {
      setChangeNextBusy(false);
    }
  }

  const changeNextSourceNode = changeNextModal
    ? nodes.find((n) => n.id === changeNextModal.nodeId) ?? null
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Editor de flujo conversacional</h1>
          <p className="text-sm text-slate-500 font-mono mt-0.5">{flowCode}</p>
          <p className="text-sm text-slate-600 mt-1">
            Pasos del bot, mensajes, botones o listas, capturas y el siguiente paso en WhatsApp.
          </p>
        </div>
        <Link
          href="/configuracion/conversaciones/flujos"
          className="text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Volver a Configuración de Flujos
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {(["pasos", "automatizaciones"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setEditorTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              editorTab === tab
                ? "bg-[#0EA5E9] text-white border-[#0EA5E9]"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab === "pasos" ? "Pasos del flujo" : "Automatizaciones"}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 whitespace-pre-wrap flex items-start justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            className="text-red-500 hover:text-red-700 shrink-0"
            onClick={() => setError(null)}
            aria-label="Cerrar el mensaje de error"
          >
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 flex items-start justify-between gap-3">
          <span>{success}</span>
          <button
            type="button"
            className="text-emerald-600 hover:text-emerald-800 shrink-0"
            onClick={() => setSuccess(null)}
            aria-label="Cerrar el mensaje"
          >
            ✕
          </button>
        </div>
      )}

      {editorTab === "pasos" && (
        <>
          {/* Barra de trabajo: buscar, crear y ver advertencias sin tapar la lista de pasos. */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            <div className="p-3 flex flex-wrap items-center gap-3">
              <input
                className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Buscar paso por código, mensaje o botón…"
                value={nodeQuery}
                onChange={(e) => setNodeQuery(e.target.value)}
                aria-label="Buscar paso"
              />
              <span className="text-xs text-slate-500">
                {visibleNodes.length} de {orderedNodes.length} pasos
              </span>
              {dirtyNodeIds.size > 0 && (
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  {dirtyNodeIds.size} con cambios sin guardar
                </span>
              )}
            </div>

            <details className="group">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span className="text-slate-400 group-open:rotate-90 transition-transform">▸</span>
                Crear un paso nuevo
              </summary>
              <form onSubmit={createNode} className="px-3 pb-3 flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs text-slate-500 mb-1" htmlFor="new-node-code">
                    Nombre del paso (código interno)
                  </label>
                  <input
                    id="new-node-code"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                    value={newNodeCode}
                    onChange={(e) => setNewNodeCode(e.target.value)}
                    placeholder="ej: datos_pago"
                  />
                </div>
                <div className="min-w-[180px]">
                  <label className="block text-xs text-slate-500 mb-1" htmlFor="new-node-type">
                    Tipo de paso
                  </label>
                  <select
                    id="new-node-type"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={newNodeType}
                    onChange={(e) => setNewNodeType(e.target.value)}
                  >
                    {NODE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={creatingNode}
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {creatingNode ? "Creando..." : "Crear paso"}
                </button>
              </form>
            </details>

            {graphWarnings.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-amber-900 bg-amber-50/60 hover:bg-amber-50 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="text-amber-500 group-open:rotate-90 transition-transform">▸</span>
                  {graphWarnings.length}{" "}
                  {graphWarnings.length === 1 ? "advertencia del grafo" : "advertencias del grafo"} (no bloquean el
                  guardado)
                </summary>
                <ul className="list-disc pl-9 pr-3 py-2 space-y-1 text-sm text-amber-900 bg-amber-50/40">
                  {graphWarnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>{w.message}</li>
                  ))}
                </ul>
              </details>
            )}

            <details className="group">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span className="text-slate-400 group-open:rotate-90 transition-transform">▸</span>
                Cómo funciona este editor
              </summary>
              <div className="px-3 pb-3 text-sm text-slate-600 space-y-1.5">
                <p>
                  Este flujo puede tener conversaciones activas: insertar pasos o cambiar destinos afecta las próximas
                  respuestas del bot en las conversaciones que pasen por ese punto.
                </p>
                <p>
                  El bot avanza por el <strong>destino de cada paso</strong>, no por el orden de esta lista. Arrastrar
                  las tarjetas solo cambia cómo las ves acá.
                </p>
                <p>
                  El tilde <strong>«Activo»</strong> se guarda solo. Todo lo demás de un paso se guarda con el botón{" "}
                  <strong>«Guardar paso»</strong>, al final del panel de edición.
                </p>
              </div>
            </details>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-400 animate-pulse">Cargando pasos...</div>
          ) : orderedNodes.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
              Este flujo todavía no tiene pasos. Creá el primero desde «Crear un paso nuevo».
            </div>
          ) : visibleNodes.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
              Ningún paso coincide con «{nodeQuery}».
            </div>
          ) : (
            <div className="space-y-4">
              {visibleNodes.map(({ node, index }) => (
                <FlowNodeCard
                  key={node.id}
                  node={node}
                  index={index}
                  isExpanded={expandedNodeIds.has(node.id)}
                  isDirty={dirtyNodeIds.has(node.id)}
                  isSaving={savingNodeId === node.id}
                  isDeleting={deletingNodeId === node.id}
                  /** Con un filtro activo el arrastre movería posiciones que no se ven: se desactiva. */
                  reorderBusy={reorderBusy || nodeQuery.trim().length > 0}
                  togglingActive={togglingActiveNodeId === node.id}
                  incomingLabels={incomingConnections.get(node.node_code) ?? []}
                  hasSelectableContext={(incomingConnections.get(node.node_code) ?? []).some((l) =>
                    l.includes(">")
                  )}
                  pickerItems={pickerItemsExcluding(node.node_code)}
                  nextStepLabel={nextStepLabel}
                  flowSorteoId={flowSorteoId}
                  creatingBlockKey={creatingBlockKey}
                  blockBusyKey={blockBusyKey}
                  optionSaveError={optionSaveError}
                  optionEditorMode={optionEditorMode}
                  optionSimpleDrafts={optionSimpleDrafts}
                  optionPayloadDrafts={optionPayloadDrafts}
                  optionFinalizeSorteo={optionFinalizeSorteo}
                  onToggleExpand={handleToggleExpand}
                  onToggleActive={(n, v) => void handleToggleActive(n, v)}
                  onPatchNode={patchNode}
                  onPatchBlock={patchBlock}
                  onSaveNode={(n) => void handleSaveNode(n)}
                  onDiscardChanges={handleDiscardChanges}
                  onDeleteNode={(n) => void deleteNode(n)}
                  onDragStartNode={() => undefined}
                  onDropNode={(draggedId, targetId) => void applyNodeReorder(draggedId, targetId)}
                  onCreateBlock={handleCreateBlock}
                  onSaveBlock={handleSaveBlock}
                  onMoveBlock={handleMoveBlock}
                  onDeleteBlock={handleDeleteBlock}
                  onUploadImage={uploadImage}
                  onError={setError}
                  onInsertAfterNode={openInsertForNode}
                  onChangeNodeNext={openChangeNextForNode}
                  onInsertAfterOption={openInsertForOption}
                  onChangeOptionNext={openChangeNextForOption}
                  onPatchOption={patchOption}
                  onSetSimpleDraft={setSimpleDraft}
                  onSetPayloadDraft={(optionId, value) =>
                    setOptionPayloadDrafts((prev) => ({ ...prev, [optionId]: value }))
                  }
                  onToggleEditorMode={(optionId) =>
                    setOptionEditorMode((prev) => ({
                      ...prev,
                      [optionId]: (prev[optionId] ?? "simple") === "simple" ? "advanced" : "simple",
                    }))
                  }
                  onToggleFinalizeSorteo={(optionId, checked) =>
                    setOptionFinalizeSorteo((prev) => ({ ...prev, [optionId]: checked }))
                  }
                  onSaveOption={handleSaveOption}
                  onDeleteOption={handleDeleteOption}
                  onCreateOption={handleCreateOption}
                />
              ))}
            </div>
          )}

          {insertModal && (
            <InsertBetweenModal
              state={insertModal}
              draft={insertDraft}
              busy={insertBusy}
              onChangeDraft={(patch) => setInsertDraft((d) => ({ ...d, ...patch }))}
              onCancel={() => setInsertModal(null)}
              onSubmit={() => void submitInsertBetween()}
            />
          )}

          {changeNextModal && (
            <ChangeNextModal
              kind={changeNextModal.kind}
              value={changeNextValue}
              busy={changeNextBusy}
              pickerItems={
                changeNextSourceNode ? pickerItemsExcluding(changeNextSourceNode.node_code) : nodePickerOptions
              }
              onChangeValue={setChangeNextValue}
              onCancel={() => setChangeNextModal(null)}
              onSubmit={() => void applyChangeNextModal()}
            />
          )}

          <FlowSorteoPanel
            sorteosOptions={sorteosOptions}
            flowSorteoId={flowSorteoId}
            flowSorteoNombre={flowSorteoNombre}
            sorteoDraft={sorteoDraft}
            onChangeSorteoDraft={setSorteoDraft}
            savingSorteoLink={savingSorteoLink}
            onSaveSorteoLink={() => void saveSorteoAssociation()}
            incompleteMsgDraft={sorteoIncompleteMsgDraft}
            onChangeIncompleteMsg={setSorteoIncompleteMsgDraft}
            savingIncompleteMsg={savingSorteoIncompleteMsg}
            onSaveIncompleteMsg={() => void saveSorteoIncompleteMessage()}
          />
        </>
      )}

      {editorTab === "automatizaciones" && (
        <FlowRecontactAutomationsPanel flowCode={flowCode} nodePickerOptions={nodePickerOptions} />
      )}
    </div>
  );
}
