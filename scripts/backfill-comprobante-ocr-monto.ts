/**
 * Recalcula `ocr_monto` de los comprobantes ya procesados con el selector corregido.
 *
 *   npx tsx scripts/backfill-comprobante-ocr-monto.ts                  (simulacion, no escribe)
 *   npx tsx scripts/backfill-comprobante-ocr-monto.ts --aplicar        (escribe)
 *   npx tsx scripts/backfill-comprobante-ocr-monto.ts --schema=mggroup
 *
 * Hasta el arreglo, la deteccion de moneda cruzaba renglones y podia elegir el numero de
 * comprobante o el año en lugar del importe. Este script vuelve a pasar el texto OCR ya
 * guardado por el selector y corrige `chat_comprobante_validaciones.ocr_monto` y la copia en
 * `chat_flow_data.sorteo_comprobante_ocr_monto`.
 *
 * No revalida ni cambia `estado_validacion`: solo repara el dato mal extraido. Sin
 * `--aplicar` no escribe nada, solo lista lo que cambiaria.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { selectReceiptMontoFromOcrText } from "../src/lib/chat/comprobante-ocr-monto-selection";

config({ path: ".env.local" });

const APLICAR = process.argv.includes("--aplicar");
const SCHEMA =
  process.argv.find((a) => a.startsWith("--schema="))?.split("=")[1]?.trim() ||
  process.env.NEURA_CLIENT_SCHEMA?.trim() ||
  "";

type FilaValidacion = {
  id: string;
  conversation_id: string | null;
  flow_session_id: string | null;
  ocr_text_raw: string | null;
  ocr_monto: string | null;
  created_at: string | null;
};

function gs(v: string | null): string {
  const t = (v ?? "").trim();
  if (!t) return "(vacio)";
  const n = Number(t);
  return Number.isFinite(n) ? n.toLocaleString("es-PY") : t;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  if (!SCHEMA) {
    console.error("Falta el schema: usa --schema=mggroup o defini NEURA_CLIENT_SCHEMA.");
    process.exit(1);
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: SCHEMA },
  });

  console.log(`Schema: ${SCHEMA}`);
  console.log(APLICAR ? "Modo: APLICAR (escribe)" : "Modo: simulacion (no escribe)");
  console.log("");

  const { data, error } = await sb
    .from("chat_comprobante_validaciones")
    .select("id, conversation_id, flow_session_id, ocr_text_raw, ocr_monto, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("No se pudo leer chat_comprobante_validaciones:", error.message);
    process.exit(1);
  }

  const filas = (data ?? []) as FilaValidacion[];
  console.log(`Comprobantes en la tabla: ${filas.length}`);

  let sinTexto = 0;
  let iguales = 0;
  const cambios: Array<{ fila: FilaValidacion; nuevo: string; motivo: string }> = [];

  for (const fila of filas) {
    const texto = (fila.ocr_text_raw ?? "").trim();
    if (!texto) {
      sinTexto += 1;
      continue;
    }
    const r = selectReceiptMontoFromOcrText(texto, {});
    const actual = (fila.ocr_monto ?? "").trim();
    if (r.monto === actual) {
      iguales += 1;
      continue;
    }
    cambios.push({ fila, nuevo: r.monto, motivo: r.audit.chosen_reason });
  }

  console.log(`Sin texto OCR guardado (no se pueden recalcular): ${sinTexto}`);
  console.log(`Ya estaban bien: ${iguales}`);
  console.log(`A corregir: ${cambios.length}`);
  console.log("");

  for (const c of cambios) {
    const fecha = (c.fila.created_at ?? "").slice(0, 16).replace("T", " ");
    console.log(`  ${fecha}  ${gs(c.fila.ocr_monto)}  ->  ${gs(c.nuevo)}   (${c.motivo})`);
  }

  if (cambios.length === 0) {
    console.log("\nNada que corregir.");
    return;
  }

  if (!APLICAR) {
    console.log("\nSimulacion: no se escribio nada. Volve a correr con --aplicar para guardar.");
    return;
  }

  console.log("");
  let okVal = 0;
  let okFlow = 0;
  const errores: string[] = [];

  for (const c of cambios) {
    const { error: eVal } = await sb
      .from("chat_comprobante_validaciones")
      .update({ ocr_monto: c.nuevo || null })
      .eq("id", c.fila.id);
    if (eVal) {
      errores.push(`validacion ${c.fila.id}: ${eVal.message}`);
      continue;
    }
    okVal += 1;

    /** Copia que ve el flujo. Puede no existir (sesion vieja o limpiada): no es error. */
    if (c.fila.conversation_id && c.fila.flow_session_id) {
      const { error: eFlow } = await sb
        .from("chat_flow_data")
        .update({ field_value: c.nuevo })
        .eq("conversation_id", c.fila.conversation_id)
        .eq("flow_session_id", c.fila.flow_session_id)
        .eq("field_name", "sorteo_comprobante_ocr_monto");
      if (eFlow) {
        errores.push(`flow_data ${c.fila.conversation_id}: ${eFlow.message}`);
      } else {
        okFlow += 1;
      }
    }
  }

  console.log(`Validaciones actualizadas: ${okVal} de ${cambios.length}`);
  console.log(`Copias en chat_flow_data actualizadas: ${okFlow}`);
  if (errores.length > 0) {
    console.error(`\nErrores (${errores.length}):`);
    for (const e of errores.slice(0, 20)) console.error("  " + e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
