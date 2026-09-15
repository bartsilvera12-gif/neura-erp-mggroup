/**
 * Comprobantes y compras por persona, contra un Postgres de verdad (PGlite, en memoria).
 *
 * Reproduce el caso que reportó el cliente: una persona compra varias veces (50.000 y
 * 100.000), una de las compras queda con el comprobante en revisión y nunca da boletas, y no
 * encuentra nada. Buscándola por teléfono, cédula o nombre tienen que aparecer todos sus
 * comprobantes, con las boletas de cada uno y el que quedó pendiente; por número de boleta,
 * la compra de esa boleta.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobantes-compras.ts
 * (necesita @electric-sql/pglite instalado aparte; no es dependencia del proyecto)
 */

process.env.NEURA_INSTANCE_MODE = "single_client";
process.env.NEURA_CLIENT_SCHEMA = "mggroup";
import type { Pool } from "pg";
import { buscarComprobantesYCompras } from "@/lib/sorteos/comprobantes-compras-pg";
import { prepararBusqueda } from "@/lib/sorteos/comprobantes-compras-tipos";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PGlite } = require(process.env.PGLITE_PATH ?? "@electric-sql/pglite");

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

const EMP = "00000000-0000-0000-0000-000000000001";
const OTRA = "00000000-0000-0000-0000-000000000002";
const SOR = "00000000-0000-0000-0000-0000000000aa";

async function armarBase(conColumnasOpcionales: boolean) {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA mggroup;
    CREATE TABLE mggroup.sorteos (id uuid PRIMARY KEY, nombre text);
    CREATE TABLE mggroup.chat_contacts (id uuid PRIMARY KEY, empresa_id uuid, phone_number text, name text);
    CREATE TABLE mggroup.chat_conversations (id uuid PRIMARY KEY, empresa_id uuid, contact_id uuid);
    CREATE TABLE mggroup.chat_flow_data (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flow_session_id uuid, field_name text, field_value text
    );
    CREATE TABLE mggroup.sorteo_entradas (
      id uuid PRIMARY KEY, empresa_id uuid, sorteo_id uuid,
      ${conColumnasOpcionales ? "numero_orden integer, venta_origen text," : ""}
      whatsapp_numero text, nombre_participante text, documento text, cantidad_boletos int,
      monto_total numeric, estado_pago text, revendedor_id uuid, chat_conversation_id uuid,
      created_at timestamptz
    );
    CREATE TABLE mggroup.sorteo_cupones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entrada_id uuid, numero_cupon text);
    CREATE TABLE mggroup.chat_comprobante_validaciones (
      id uuid PRIMARY KEY, empresa_id uuid, conversation_id uuid, flow_session_id uuid,
      comprobante_url text, estado_validacion text, motivo_validacion text,
      ocr_monto text, ocr_referencia text, ocr_banco text,
      ${conColumnasOpcionales ? "monto_validacion_ocr_gs numeric, monto_validacion_esperado_gs numeric, manual_approval_at timestamptz, manual_approval_note text," : ""}
      sorteo_entrada_id uuid, created_at timestamptz
    );
    INSERT INTO mggroup.sorteos VALUES ('${SOR}', 'Nissan Frontier');
  `);

  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  /** Persona que reportó el problema: tres compras por WhatsApp. */
  await db.exec(`
    INSERT INTO mggroup.chat_contacts VALUES ('${id(101)}', '${EMP}', '595981111222', 'Maria WhatsApp');
    INSERT INTO mggroup.chat_conversations VALUES ('${id(201)}', '${EMP}', '${id(101)}');
    INSERT INTO mggroup.chat_flow_data (flow_session_id, field_name, field_value) VALUES
      ('${id(301)}', 'nombre', 'María González'), ('${id(301)}', 'cedula', '4567890'),
      ('${id(302)}', 'nombre', 'María González'), ('${id(302)}', 'cedula', '4567890'),
      ('${id(303)}', 'nombre', 'María González'), ('${id(303)}', 'cedula', '4567890');

    INSERT INTO mggroup.sorteo_entradas (id, empresa_id, sorteo_id, ${conColumnasOpcionales ? "numero_orden," : ""}
      whatsapp_numero, nombre_participante, documento, cantidad_boletos, monto_total, estado_pago, chat_conversation_id, created_at)
    VALUES
      ('${id(401)}', '${EMP}', '${SOR}', ${conColumnasOpcionales ? "310," : ""} '595981111222', 'María González', '4567890', 5, 50000, 'pendiente_revision', '${id(201)}', '2026-09-10T15:00:00Z'),
      ('${id(402)}', '${EMP}', '${SOR}', ${conColumnasOpcionales ? "320," : ""} '595981111222', 'María González', '4567890', 10, 100000, 'pendiente_revision', '${id(201)}', '2026-09-11T15:00:00Z');
    INSERT INTO mggroup.sorteo_cupones (entrada_id, numero_cupon) VALUES
      ('${id(401)}', '1001'), ('${id(401)}', '1002'), ('${id(401)}', '1003'), ('${id(401)}', '1004'), ('${id(401)}', '1005'),
      ${Array.from({ length: 10 }, (_, i) => `('${id(402)}', '${2001 + i}')`).join(", ")};

    INSERT INTO mggroup.chat_comprobante_validaciones (id, empresa_id, conversation_id, flow_session_id, estado_validacion, motivo_validacion, ocr_monto, ocr_referencia, sorteo_entrada_id, created_at) VALUES
      ('${id(501)}', '${EMP}', '${id(201)}', '${id(301)}', 'valido', null, '50.000', '11112222', '${id(401)}', '2026-09-10T14:59:00Z'),
      ('${id(502)}', '${EMP}', '${id(201)}', '${id(302)}', 'valido', null, '100.000', '33334444', '${id(402)}', '2026-09-11T14:59:00Z'),
      ('${id(503)}', '${EMP}', '${id(201)}', '${id(303)}', 'revision_manual', 'ocr_sin_monto', '100.000', '55556666', null, '2026-09-12T14:59:00Z');
  `);

  /** Otra persona, una venta de vendedor sin comprobante, y datos de otra empresa. */
  await db.exec(`
    INSERT INTO mggroup.chat_contacts VALUES ('${id(102)}', '${EMP}', '595982333444', 'Pedro');
    INSERT INTO mggroup.chat_conversations VALUES ('${id(202)}', '${EMP}', '${id(102)}');
    INSERT INTO mggroup.chat_comprobante_validaciones (id, empresa_id, conversation_id, flow_session_id, estado_validacion, ocr_monto, sorteo_entrada_id, created_at) VALUES
      ('${id(504)}', '${EMP}', '${id(202)}', '${id(304)}', 'rechazado_manual', '10.000', null, '2026-09-12T10:00:00Z'),
      ('${id(505)}', '${EMP}', '${id(202)}', '${id(305)}', 'duplicado_hash', '10.000', null, '2026-09-13T10:00:00Z'),
      ('${id(599)}', '${OTRA}', '${id(202)}', '${id(399)}', 'revision_manual', '10.000', null, '2026-09-13T10:00:00Z');
    INSERT INTO mggroup.sorteo_entradas (id, empresa_id, sorteo_id, whatsapp_numero, nombre_participante, documento, cantidad_boletos, monto_total, estado_pago, revendedor_id, created_at)
    VALUES ('${id(403)}', '${EMP}', '${SOR}', '0981111222', 'María González', '4.567.890', 2, 20000, 'confirmado', '${id(900)}', '2026-09-09T12:00:00Z');
    INSERT INTO mggroup.sorteo_cupones (entrada_id, numero_cupon) VALUES ('${id(403)}', '0777'), ('${id(403)}', '0778');
  `);

  return db as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
}

async function main() {
  for (const opcionales of [true, false]) {
    console.log(`\n=== ${opcionales ? "Con" : "Sin"} las columnas opcionales ===`);
    const db = await armarBase(opcionales);
    const pool = db as unknown as Pool;
    const buscar = (q: string | null, estado: "todos" | "pendientes" | "aprobados" | "rechazados" = "todos") =>
      buscarComprobantesYCompras(pool, "mggroup", EMP, { q, estado });

    console.log("\nBuscando a la persona del reclamo");
    for (const [como, q] of [
      ["por teléfono con 595", "595981111222"],
      ["por teléfono con 0", "0981 111 222"],
      ["por cédula", "4567890"],
      ["por nombre", "maría gonz"],
    ] as const) {
      const r = await buscar(q);
      const comp = r.filas.filter((f) => f.tipo === "comprobante");
      chequear(`${como}: aparecen sus 3 comprobantes`, comp.length === 3, r.filas.map((f) => [f.tipo, f.estado_validacion, f.nombre]));
    }

    const porBoleta = await buscar("2005");
    chequear(
      "por un número de boleta: la compra de esa boleta",
      porBoleta.filas.length === 1 && porBoleta.filas[0].validacion_id?.endsWith("502") === true,
      porBoleta.filas.map((f) => f.validacion_id)
    );

    const r = await buscar("595981111222");
    const pendiente = r.filas.find((f) => f.validacion_id?.endsWith("503"));
    chequear("el de 100.000 en revisión aparece sin boletas", pendiente?.boletas.length === 0 && pendiente?.monto_comprobante === 100000, pendiente);
    chequear("con su nombre y cédula del chat", pendiente?.nombre === "María González" && pendiente?.documento === "4567890", pendiente);
    const de50 = r.filas.find((f) => f.validacion_id?.endsWith("501"));
    chequear("el de 50.000 con sus 5 boletas", de50?.boletas.join() === "1001,1002,1003,1004,1005", de50?.boletas);
    const de100 = r.filas.find((f) => f.validacion_id?.endsWith("502"));
    chequear("el de 100.000 aprobado con sus 10 boletas", de100?.boletas.length === 10 && de100?.monto_compra === 100000);
    if (opcionales) chequear("con el número de orden", de50?.numero_orden === "310", de50?.numero_orden);
    chequear(
      "la compra del vendedor (sin comprobante) también aparece",
      r.filas.some((f) => f.tipo === "compra_sin_comprobante" && f.boletas.join() === "0777,0778" && f.canal === "vendedor"),
      r.filas.map((f) => [f.tipo, f.canal])
    );
    chequear("resumen: 3 compras, 17 boletas, 170.000", r.resumen.compras === 3 && r.resumen.boletas === 17 && r.resumen.monto_compras === 170000, r.resumen);
    chequear("resumen: 1 comprobante pendiente", r.resumen.pendientes === 1, r.resumen);
    chequear("ordenado del más nuevo al más viejo", r.filas.every((f, i) => i === 0 || r.filas[i - 1].fecha >= f.fecha));
    chequear("no trae nada de otra persona", r.filas.every((f) => f.nombre !== "Pedro" && f.contacto_nombre !== "Pedro"));

    console.log("\nFiltros de estado (sin buscar a nadie)");
    const pend = await buscar(null, "pendientes");
    chequear(
      "pendientes: el de revisión y el duplicado, no el rechazado ni los que dieron boletas",
      pend.filas.map((f) => f.validacion_id?.slice(-3)).sort().join() === "503,505",
      pend.filas.map((f) => [f.validacion_id?.slice(-3), f.estado_validacion])
    );
    chequear("no mezcla otra empresa", pend.filas.every((f) => !f.validacion_id?.endsWith("599")));
    const rech = await buscar(null, "rechazados");
    chequear("rechazados: solo el rechazado a mano", rech.filas.map((f) => f.validacion_id?.slice(-3)).join() === "504");
    const apr = await buscar(null, "aprobados");
    chequear("aprobados: los dos que dieron boletas", apr.filas.map((f) => f.validacion_id?.slice(-3)).sort().join() === "501,502");
    const todos = await buscar(null);
    chequear("sin buscar no mete las ventas de mostrador", todos.filas.every((f) => f.tipo === "comprobante"));

    console.log("\nBúsquedas que no tienen que traer nada");
    chequear("un teléfono que no existe", (await buscar("0999000000")).filas.length === 0);
    chequear("un nombre que no existe", (await buscar("zzzz")).filas.length === 0);
    chequear("un % no rompe ni trae todo", (await buscar("%")).filas.length === 0);
  }

  console.log("\nCómo se interpreta lo que se escribe");
  chequear("teléfono: últimos 8", prepararBusqueda("+595 981 111-222").ultimos8 === "81111222");
  chequear("cédula corta: sin teléfono", prepararBusqueda("45678").ultimos8 === null && prepararBusqueda("45678").digitos === "45678");
  chequear("nombre: sin dígitos", prepararBusqueda("María").digitos === null);
  chequear("vacío", prepararBusqueda("   ").texto === null);

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
