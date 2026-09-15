/**
 * Pruebas del rechazo manual de un comprobante, con una base de mentira que anota lo que se
 * escribe.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobante-rechazo.ts
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { rechazarComprobanteManual } from "@/lib/chat/comprobante-rechazo-manual";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

type Fila = Record<string, unknown>;
type Escritura = { tabla: string; valores: Fila; filtros: Record<string, unknown> };

/** Tablas en memoria; `select … eq … maybeSingle` y `update … eq` sobre ellas. */
function baseFalsa(tablas: Record<string, Fila[]>) {
  const escrituras: Escritura[] = [];
  const cumple = (f: Fila, filtros: Record<string, unknown>) =>
    Object.entries(filtros).every(([k, v]) => f[k] === v);
  const from = (tabla: string) => {
    const filtros: Record<string, unknown> = {};
    let valores: Fila | null = null;
    const q = {
      select: () => q,
      update: (v: Fila) => {
        valores = v;
        return q;
      },
      eq: (k: string, v: unknown) => {
        filtros[k] = v;
        return q;
      },
      maybeSingle: async () => ({ data: (tablas[tabla] ?? []).find((f) => cumple(f, filtros)) ?? null, error: null }),
      then: (res: (r: { error: null }) => unknown) => {
        if (valores) {
          escrituras.push({ tabla, valores, filtros: { ...filtros } });
          for (const f of tablas[tabla] ?? []) if (cumple(f, filtros)) Object.assign(f, valores);
        }
        return Promise.resolve({ error: null }).then(res);
      },
    };
    return q;
  };
  return { db: { from } as unknown as AppSupabaseClient, escrituras };
}

const base = () => ({
  chat_comprobante_validaciones: [
    { id: "v1", empresa_id: "e1", estado_validacion: "revision_manual", motivo_validacion: "ocr_sin_monto", conversation_id: "c1", flow_session_id: "s1", sorteo_entrada_id: null },
    { id: "v2", empresa_id: "e1", estado_validacion: "valido", motivo_validacion: null, conversation_id: "c1", flow_session_id: "s2", sorteo_entrada_id: "o2" },
    { id: "v3", empresa_id: "e1", estado_validacion: "rechazado_manual", motivo_validacion: "rechazado_por_admin", conversation_id: "c1", flow_session_id: "s3", sorteo_entrada_id: null },
    { id: "v4", empresa_id: "e1", estado_validacion: "revision_manual", motivo_validacion: null, conversation_id: "c1", flow_session_id: "s4", sorteo_entrada_id: null },
  ] as Fila[],
  sorteo_entradas: [{ id: "o2", empresa_id: "e1", estado_pago: "pendiente_revision", observacion_interna: null }] as Fila[],
  chat_flow_data: [
    { flow_session_id: "s1", field_name: "sorteo_comprobante_validacion_id", field_value: "v1" },
    { flow_session_id: "s1", field_name: "sorteo_comprobante_estado_validacion", field_value: "revision_manual" },
    { flow_session_id: "s1", field_name: "sorteo_comprobante_motivo_validacion", field_value: "ocr_sin_monto" },
    /** En s4 ya hay un comprobante más nuevo: el flujo no se toca. */
    { flow_session_id: "s4", field_name: "sorteo_comprobante_validacion_id", field_value: "v9" },
    { flow_session_id: "s4", field_name: "sorteo_comprobante_estado_validacion", field_value: "valido" },
  ] as Fila[],
});

const rechazar = (db: AppSupabaseClient, validacionId: string, motivo = "El pago no está en la cuenta") =>
  rechazarComprobanteManual({
    supabase: db,
    empresaId: "e1",
    usuarioId: "u1",
    validacionId,
    motivo,
    avisarCliente: false,
  });

async function main() {
  console.log("\nComprobante en revisión, sin compra");
  {
    const t = base();
    const { db } = baseFalsa(t);
    const r = await rechazar(db, "v1");
    chequear("sale bien", r.ok && !r.ordenRechazada && !r.avisado, r);
    const v = t.chat_comprobante_validaciones[0];
    chequear("queda rechazado a mano", v.estado_validacion === "rechazado_manual" && v.motivo_validacion === "rechazado_por_admin", v);
    chequear("guarda el estado anterior", v.previous_estado_validacion === "revision_manual" && v.previous_motivo_validacion === "ocr_sin_monto", v);
    chequear("con quién, cuándo y por qué", v.manual_approval_usuario_id === "u1" && Boolean(v.manual_approval_at) && v.manual_approval_note === "El pago no está en la cuenta" && v.manual_approval_source === "erp_rechazo", v);
    const estadoChat = t.chat_flow_data.find((f) => f.flow_session_id === "s1" && f.field_name === "sorteo_comprobante_estado_validacion");
    chequear("el chat ya no lo toma como válido para cerrar", estadoChat?.field_value === "rechazado_manual", estadoChat);
  }

  console.log("\nComprobante que ya generó una compra");
  {
    const t = base();
    const { db } = baseFalsa(t);
    const r = await rechazar(db, "v2", "Transferencia revertida por el banco");
    chequear("avisa que anuló la compra", r.ok && r.ordenRechazada, r);
    const o = t.sorteo_entradas[0];
    chequear("la compra queda rechazada", o.estado_pago === "rechazado", o);
    chequear("con el motivo en la observación", String(o.observacion_interna).includes("Transferencia revertida"), o);
  }

  console.log("\nCasos que no tienen que hacer nada");
  {
    const t = base();
    const { db, escrituras } = baseFalsa(t);
    const ya = await rechazar(db, "v3");
    chequear("uno ya rechazado no se vuelve a rechazar", !ya.ok && escrituras.length === 0, ya);
    const sinMotivo = await rechazar(db, "v1", " a ");
    chequear("sin motivo no rechaza", !sinMotivo.ok && escrituras.length === 0, sinMotivo);
    const noExiste = await rechazar(db, "v404");
    chequear("uno que no existe", !noExiste.ok && escrituras.length === 0, noExiste);
  }

  console.log("\nSi la persona ya mandó otro comprobante, el flujo no se toca");
  {
    const t = base();
    const { db } = baseFalsa(t);
    await rechazar(db, "v4");
    const estadoChat = t.chat_flow_data.find((f) => f.flow_session_id === "s4" && f.field_name === "sorteo_comprobante_estado_validacion");
    chequear("el comprobante nuevo sigue válido en el chat", estadoChat?.field_value === "valido", estadoChat);
  }

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
