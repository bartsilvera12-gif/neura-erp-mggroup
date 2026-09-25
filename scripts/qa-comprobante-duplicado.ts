/**
 * Cuándo un comprobante cuenta como repetido.
 *
 * Caso del 24/09/2026: la persona mandó su comprobante, la compra no se cerró, el bot le pidió
 * el comprobante otra vez y al mandar la misma imagen se la rechazó por «duplicado». Quedó
 * trabada sin salida. Reenviar el propio pago, mientras no haya generado ninguna compra, no es
 * un duplicado; sí lo es el mismo comprobante en otro chat o uno que ya dio boletas.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobante-duplicado.ts
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  existsHashDuplicate,
  existsOcrRefDuplicate,
} from "@/lib/chat/comprobante-validation-service";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

type Fila = Record<string, unknown>;

function baseFalsa(filas: Fila[]) {
  const from = () => {
    const pruebas: Array<(f: Fila) => boolean> = [];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = (k: string, v: unknown) => (pruebas.push((f) => f[k] === v), q);
    q.neq = (k: string, v: unknown) => (pruebas.push((f) => f[k] !== v), q);
    q.in = (k: string, v: unknown[]) => (pruebas.push((f) => v.includes(f[k])), q);
    q.limit = async () => ({ data: filas.filter((f) => pruebas.every((p) => p(f))), error: null });
    return q;
  };
  return { from } as unknown as AppSupabaseClient;
}

const CHAT = "conv-1";
const OTRO_CHAT = "conv-2";

const previo = (extra: Fila = {}): Fila => ({
  id: "v1",
  empresa_id: "e1",
  conversation_id: CHAT,
  flow_session_id: "sesion-vieja",
  comprobante_hash: "hash-abc",
  ocr_referencia: "5924555205",
  estado_validacion: "valido",
  sorteo_entrada_id: null,
  ...extra,
});

const porHash = (filas: Fila[]) => existsHashDuplicate(baseFalsa(filas), "e1", "hash-abc", CHAT);
const porReferencia = (filas: Fila[]) =>
  existsOcrRefDuplicate(baseFalsa(filas), "e1", "5924555205", "sesion-nueva", CHAT);

async function main() {
  console.log("\nLa misma persona reenvía su comprobante (todavía sin boletas)");
  {
    chequear("por la imagen: no es duplicado", (await porHash([previo()])) === false);
    chequear("por el número de operación: tampoco", (await porReferencia([previo()])) === false);
  }

  console.log("\nLo que sí se sigue bloqueando");
  {
    chequear(
      "el mismo comprobante que ya generó una compra",
      (await porHash([previo({ sorteo_entrada_id: "orden-1" })])) === true
    );
    chequear(
      "el mismo comprobante en el chat de otra persona",
      (await porHash([previo({ conversation_id: OTRO_CHAT })])) === true
    );
    chequear(
      "el número de operación usado en otro chat",
      (await porReferencia([previo({ conversation_id: OTRO_CHAT })])) === true
    );
    chequear(
      "el número de operación que ya dio boletas",
      (await porReferencia([previo({ sorteo_entrada_id: "orden-1" })])) === true
    );
    chequear(
      "entre varios, alcanza con uno bloqueante",
      (await porHash([previo(), previo({ id: "v2", conversation_id: OTRO_CHAT })])) === true
    );
  }

  console.log("\nCasos de borde");
  {
    chequear("sin antecedentes, no hay duplicado", (await porHash([])) === false);
    chequear("sin hash no se busca nada", (await existsHashDuplicate(baseFalsa([previo()]), "e1", "  ", CHAT)) === false);
    chequear(
      "el de otra empresa no cuenta",
      (await porHash([previo({ empresa_id: "e2" })])) === false
    );
    chequear(
      "sin saber de qué chat viene, se bloquea igual",
      (await existsHashDuplicate(baseFalsa([previo()]), "e1", "hash-abc", "")) === true
    );
  }

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
