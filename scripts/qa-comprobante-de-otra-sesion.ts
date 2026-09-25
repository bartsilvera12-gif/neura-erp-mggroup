/**
 * El comprobante se busca en toda la conversación, no solo en la sesión de flujo.
 *
 * Caso reportado el 25/09/2026: la persona manda el comprobante, el bot lo valida, le pide los
 * datos y al confirmar responde «No encontramos el comprobante de esta compra». Pasa cuando la
 * sesión de flujo cambia entre el comprobante y la confirmación: `chat_flow_data` está guardado
 * por sesión y en la nueva no hay nada.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobante-de-otra-sesion.ts
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { finalizeSorteoOrderFromConfirmedFlowData } from "@/lib/sorteos/sorteo-order-from-chat";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

type Fila = Record<string, unknown>;

/** Supabase de mentira que sí aplica eq / is / in / gte sobre filas en memoria. */
function baseFalsa(tablas: Record<string, Fila[]>) {
  const from = (tabla: string) => {
    const filas = tablas[tabla] ?? [];
    const pruebas: Array<(f: Fila) => boolean> = [];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    const filtradas = () =>
      filas
        .filter((f) => pruebas.every((prueba) => prueba(f)))
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    q.select = chain;
    q.eq = (k: string, v: unknown) => (pruebas.push((f) => f[k] === v), q);
    q.is = (k: string, v: unknown) => (pruebas.push((f) => (f[k] ?? null) === v), q);
    q.in = (k: string, v: unknown[]) => (pruebas.push((f) => v.includes(f[k])), q);
    q.gte = (k: string, v: string) => (pruebas.push((f) => String(f[k]) >= v), q);
    q.order = chain;
    q.maybeSingle = async () => ({ data: filtradas()[0] ?? null, error: null });
    q.limit = async () => ({ data: filtradas(), error: null });
    return q;
  };
  return { from } as unknown as AppSupabaseClient;
}

const ahora = Date.now();
const haceHoras = (h: number) => new Date(ahora - h * 3600_000).toISOString();

const comprobante = (extra: Fila = {}): Fila => ({
  id: "11111111-1111-1111-1111-111111111111",
  empresa_id: "e1",
  conversation_id: "c1",
  comprobante_url: "https://storage/comprobante.jpg",
  comprobante_media_id: "media-123",
  estado_validacion: "valido",
  sorteo_entrada_id: null,
  created_at: haceHoras(1),
  ...extra,
});

/** El flujo del sorteo con su precio: 1 boleto = 10.000 Gs. */
const CATALOGO = {
  chat_flows: [{ empresa_id: "e1", flow_code: "nissan_frontier_2020", sorteo_id: "s1", is_active: true }],
  sorteos: [{ id: "s1", empresa_id: "e1", precio_por_boleto: 10000, estado: "activo" }],
};

const cerrar = (validaciones: Fila[], flowData: Record<string, string> = {}) =>
  finalizeSorteoOrderFromConfirmedFlowData(
    baseFalsa({ ...CATALOGO, chat_comprobante_validaciones: validaciones }),
    {
    empresaId: "e1",
    conversationId: "c1",
    flowCode: "nissan_frontier_2020",
    flowSessionId: "sesion-nueva",
      whatsappNumero: "595985263955",
      flowData,
    }
  );

async function main() {
  console.log("\nLa sesión nueva no tiene el comprobante, pero la conversación sí");
  {
    const r = await cerrar([comprobante()]);
    chequear(
      "ya no le pide el comprobante de nuevo",
      !(r.ok && r.skipped && r.reason === "sin_comprobante_en_sesion"),
      r
    );
  }

  console.log("\nCuándo sí corresponde pedirlo de nuevo");
  {
    const sinNada = await cerrar([]);
    chequear("no hay ningún comprobante", sinNada.ok && sinNada.skipped && sinNada.reason === "sin_comprobante_en_sesion", sinNada);

    const usado = await cerrar([comprobante({ sorteo_entrada_id: "orden-anterior" })]);
    chequear(
      "el comprobante ya generó otra compra: no se reusa",
      usado.ok && usado.skipped && usado.reason === "sin_comprobante_en_sesion",
      usado
    );

    const enRevision = await cerrar([comprobante({ estado_validacion: "revision_manual" })]);
    chequear(
      "uno que el bot no dio por bueno no cierra la compra",
      enRevision.ok && enRevision.skipped && enRevision.reason === "sin_comprobante_en_sesion",
      enRevision
    );

    const viejo = await cerrar([comprobante({ created_at: haceHoras(30) })]);
    chequear("uno de hace más de un día tampoco", viejo.ok && viejo.skipped && viejo.reason === "sin_comprobante_en_sesion", viejo);

    const otraConversacion = await cerrar([comprobante({ conversation_id: "c2" })]);
    chequear(
      "el de otra persona nunca",
      otraConversacion.ok && otraConversacion.skipped && otraConversacion.reason === "sin_comprobante_en_sesion",
      otraConversacion
    );

    const otraEmpresa = await cerrar([comprobante({ empresa_id: "e2" })]);
    chequear("el de otra empresa tampoco", otraEmpresa.ok && otraEmpresa.skipped && otraEmpresa.reason === "sin_comprobante_en_sesion", otraEmpresa);

    const sinArchivo = await cerrar([comprobante({ comprobante_media_id: null })]);
    chequear("uno sin archivo no sirve", sinArchivo.ok && sinArchivo.skipped && sinArchivo.reason === "sin_comprobante_en_sesion", sinArchivo);
  }

  console.log("\nSi el comprobante de la sesión está rechazado, no se busca otro");
  {
    const r = await cerrar([comprobante()], {
      sorteo_comprobante_url: "https://storage/otro.jpg",
      sorteo_comprobante_media_id: "media-999",
      sorteo_comprobante_estado_validacion: "comprobante_vencido",
    });
    chequear("sigue siendo rechazo, no se cierra la compra", r.ok === true && r.skipped === true && r.reason === "comprobante_no_validado", r);
  }

  console.log("\nEntre varios, el más nuevo");
  {
    const viejo = comprobante({ id: "aaaaaaaa-1111-1111-1111-111111111111", comprobante_media_id: "media-viejo", created_at: haceHoras(5) });
    const nuevo = comprobante({ id: "bbbbbbbb-1111-1111-1111-111111111111", comprobante_media_id: "media-nuevo", created_at: haceHoras(1) });
    const r = await cerrar([viejo, nuevo]);
    chequear("toma el último que mandó", !(r.ok && r.skipped && r.reason === "sin_comprobante_en_sesion"), r);
  }

  console.log("\nUn comprobante de una compra a medias no sirve para otra más grande");
  {
    const deMenos = await cerrar([comprobante({ monto_validacion_ocr_gs: 10000 })], { cantidad: "3" });
    chequear(
      "pagó 10.000 y ahora compra 3 boletos (30.000): le vuelve a pedir el comprobante",
      deMenos.ok && deMenos.skipped && deMenos.reason === "sin_comprobante_en_sesion",
      deMenos
    );

    const justo = await cerrar([comprobante({ monto_validacion_ocr_gs: 30000 })], { cantidad: "3" });
    chequear(
      "si pagó los 30.000, cierra la compra",
      !(justo.ok && justo.skipped && justo.reason === "sin_comprobante_en_sesion"),
      justo
    );

    const sinMonto = await cerrar([comprobante({ monto_validacion_ocr_gs: null })], { cantidad: "3" });
    chequear(
      "si no se sabe cuánto decía el comprobante, no se traba la compra",
      !(sinMonto.ok && sinMonto.skipped && sinMonto.reason === "sin_comprobante_en_sesion"),
      sinMonto
    );
  }

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
