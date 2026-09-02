"use client";

import {
  MAX_WHATSAPP_IMAGE_CAPTION,
  isValidHttpUrl,
  visibleBlocksForEditor,
} from "./flow-editor-helpers";
import type { FlowNode, FlowNodeBlock } from "./flow-editor-types";

const BLOCK_TYPE_LABEL: Record<FlowNodeBlock["block_type"], string> = {
  text: "Texto",
  image: "Imagen",
  buttons: "Encabezado de botones",
};

/**
 * Bloques del mensaje de un paso (no aplica a `media`, que tiene su propio editor de burbuja).
 * El orden que se ve acá es el que se envía por WhatsApp.
 */
export function FlowNodeBlocksEditor({
  node,
  creatingBlockKey,
  blockBusyKey,
  onCreateBlock,
  onPatchBlock,
  onSaveBlock,
  onMoveBlock,
  onDeleteBlock,
  onUploadImage,
  onError,
}: {
  node: FlowNode;
  creatingBlockKey: string | null;
  blockBusyKey: (nodeId: string, blockType: FlowNodeBlock["block_type"]) => string;
  onCreateBlock: (node: FlowNode, blockType: FlowNodeBlock["block_type"]) => Promise<void>;
  onPatchBlock: (nodeId: string, blockId: string, patch: Partial<FlowNodeBlock>) => void;
  onSaveBlock: (node: FlowNode, blockId: string) => Promise<void>;
  onMoveBlock: (node: FlowNode, blockId: string, direction: -1 | 1) => Promise<void>;
  onDeleteBlock: (node: FlowNode, blockId: string) => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
  onError: (message: string) => void;
}) {
  const blocks = visibleBlocksForEditor(node);

  return (
    <section className="space-y-3 border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Bloques del mensaje</h3>
          <p className="text-[11px] text-slate-500">
            Cada bloque es una burbuja de WhatsApp, en este orden. Sin bloques se usa el mensaje simple de arriba.
          </p>
        </div>
        <div className="flex gap-2">
          {(["text", "image", "buttons"] as const).map((blockType) => (
            <button
              key={blockType}
              type="button"
              disabled={creatingBlockKey === blockBusyKey(node.id, blockType)}
              className="text-xs px-2 py-1 rounded-md border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 disabled:opacity-50"
              onClick={() => void onCreateBlock(node, blockType)}
            >
              + {BLOCK_TYPE_LABEL[blockType]}
            </button>
          ))}
        </div>
      </div>

      {blocks.length === 0 && (
        <p className="text-xs text-slate-500">Sin bloques. Se usará el mensaje simple del paso.</p>
      )}

      {blocks.map((block, bi) => (
        <div key={block.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-slate-600">
              Bloque #{bi + 1} · {BLOCK_TYPE_LABEL[block.block_type]}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs px-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={bi === 0}
                title="Subir bloque"
                onClick={() => void onMoveBlock(node, block.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="text-xs px-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={bi === blocks.length - 1}
                title="Bajar bloque"
                onClick={() => void onMoveBlock(node, block.id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => void onDeleteBlock(node, block.id)}
              >
                Eliminar
              </button>
            </div>
          </div>

          {block.block_type === "text" && (
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[64px] bg-white"
              value={block.content_text ?? ""}
              placeholder="Texto del bloque"
              onChange={(e) => onPatchBlock(node.id, block.id, { content_text: e.target.value })}
            />
          )}

          {block.block_type === "image" && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                Podés subir una imagen o pegar una URL pública (http/https).
              </p>
              <input
                type="file"
                accept="image/*"
                className="text-xs"
                onChange={async (e) => {
                  try {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const mediaUrl = await onUploadImage(file);
                    onPatchBlock(node.id, block.id, { media_url: mediaUrl });
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "No se pudo subir imagen");
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={block.media_url ?? ""}
                placeholder="URL pública de imagen"
                onChange={(e) => onPatchBlock(node.id, block.id, { media_url: e.target.value })}
              />
              {!!block.media_url && !isValidHttpUrl(block.media_url) && (
                <div className="text-[11px] text-red-600">La URL debe iniciar con http:// o https://</div>
              )}
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={block.content_text ?? ""}
                placeholder="Caption opcional"
                onChange={(e) => onPatchBlock(node.id, block.id, { content_text: e.target.value })}
              />
              <div
                className={`text-[11px] ${
                  (block.content_text ?? "").length > MAX_WHATSAPP_IMAGE_CAPTION
                    ? "text-red-600"
                    : "text-slate-500"
                }`}
              >
                Caption: {(block.content_text ?? "").length}/{MAX_WHATSAPP_IMAGE_CAPTION}
              </div>
              {block.media_url && isValidHttpUrl(block.media_url) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={block.media_url}
                  alt="Vista previa del bloque"
                  className="max-h-40 rounded border border-slate-200 bg-white"
                />
              )}
            </div>
          )}

          {block.block_type === "buttons" && (
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={block.content_text ?? ""}
              placeholder="Texto arriba de los botones"
              onChange={(e) => onPatchBlock(node.id, block.id, { content_text: e.target.value })}
            />
          )}

          <button
            type="button"
            className="text-xs text-[#0EA5E9] hover:underline"
            onClick={() => void onSaveBlock(node, block.id)}
          >
            Guardar bloque
          </button>
        </div>
      ))}
    </section>
  );
}
