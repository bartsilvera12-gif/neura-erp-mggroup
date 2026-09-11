/**
 * Ventas por canal contra un Postgres de verdad (PGlite, en memoria).
 *
 * Lo que se verifica: que cada venta caiga en su canal —bot, vendedor o carga manual—, que
 * los totales cuadren con los cupones, que las rechazadas no cuenten y que la consulta ande
 * aunque falte la columna opcional `venta_origen`.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-ventas-por-canal.ts
 * (necesita @electric-sql/pglite instalado aparte; no es dependencia del proyecto)
 */

/** Igual que en producción: instancia de un solo cliente con su schema propio. */
process.env.NEURA_INSTANCE_MODE = "single_client";
process.env.NEURA_CLIENT_SCHEMA = "mggroup";
import { cargarVentasPorCanal } from "@/lib/sorteos/ventas-por-canal-pg";

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
const SOR = "00000000-0000-0000-0000-0000000000aa";

async function armarBase(conVentaOrigen: boolean) {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA mggroup;
    CREATE TABLE mggroup.sorteo_entradas (
      id uuid PRIMARY KEY,
      empresa_id uuid NOT NULL,
      sorteo_id uuid NOT NULL,
      revendedor_id uuid,
      chat_conversation_id uuid,
      ${conVentaOrigen ? "venta_origen text," : ""}
      estado_pago text NOT NULL,
      monto_total numeric NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE mggroup.sorteo_cupones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entrada_id uuid NOT NULL,
      sorteo_id uuid NOT NULL
    );
  `);

  let n = 0;
  const venta = async (o: {
    rev?: boolean;
    chat?: boolean;
    origen?: string;
    estado?: string;
    boletas: number;
    diasAtras?: number;
  }) => {
    n++;
    const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    const cols = ["id", "empresa_id", "sorteo_id", "revendedor_id", "chat_conversation_id", "estado_pago", "monto_total", "created_at"];
    const vals: unknown[] = [
      id,
      EMP,
      SOR,
      o.rev ? "00000000-0000-0000-0000-00000000beef" : null,
      o.chat ? "00000000-0000-0000-0000-00000000c4a7" : null,
      o.estado ?? "confirmado",
      o.boletas * 10000,
      new Date(Date.now() - (o.diasAtras ?? 0) * 86_400_000).toISOString(),
    ];
    if (conVentaOrigen) {
      cols.push("venta_origen");
      vals.push(o.origen ?? null);
    }
    await db.query(
      `INSERT INTO mggroup.sorteo_entradas (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      vals
    );
    for (let i = 0; i < o.boletas; i++) {
      await db.query(`INSERT INTO mggroup.sorteo_cupones (entrada_id, sorteo_id) VALUES ($1, $2)`, [id, SOR]);
    }
  };

  // Bot: 3 compras por WhatsApp (una pendiente de revisión, una de hace 3 días).
  await venta({ chat: true, origen: "whatsapp_flow", boletas: 2 });
  await venta({ chat: true, origen: "whatsapp_flow", boletas: 1, estado: "pendiente_revision" });
  await venta({ chat: true, boletas: 5, diasAtras: 3 });
  // Vendedores: 2 ventas desde el POS o #VENTA.
  await venta({ rev: true, boletas: 4 });
  await venta({ rev: true, chat: true, boletas: 1 }); // #VENTA: tiene chat, pero la hizo un vendedor.
  // Carga manual desde el ERP.
  await venta({ origen: "erp_manual", boletas: 3 });
  // Rechazada: no cuenta en ningún canal.
  await venta({ chat: true, boletas: 9, estado: "rechazado" });

  return db;
}

async function main() {
  for (const conVentaOrigen of [true, false]) {
    console.log(`\n${conVentaOrigen ? "Con" : "Sin"} la columna venta_origen`);
    const db = await armarBase(conVentaOrigen);
    const pool = { query: (sql: string, p: unknown[]) => db.query(sql, p) };

    const r = await cargarVentasPorCanal(pool as never, "mggroup", EMP, SOR);
    const c = Object.fromEntries(r.canales.map((x) => [x.canal, x]));

    chequear("el bot: 3 ventas", c.bot.ventas === 3, c.bot);
    chequear("el bot: 8 boletas", c.bot.boletas === 8, c.bot);
    chequear("el bot: 80.000 Gs.", c.bot.monto === 80000, c.bot);
    chequear("el bot: 1 comprobante por revisar", c.bot.pendientes === 1, c.bot);
    chequear("el bot: 3 boletas hoy", c.bot.boletas_hoy === 3, c.bot);
    chequear("#VENTA cuenta como vendedor, no como bot", c.vendedor.ventas === 2 && c.vendedor.boletas === 5, c.vendedor);
    if (conVentaOrigen) {
      chequear("la carga del ERP va a manual", c.manual.ventas === 1 && c.manual.boletas === 3, c.manual);
    } else {
      /** Sin la columna no se distingue el origen; lo sin chat ni vendedor sigue siendo manual. */
      chequear("sin la columna, lo sin chat va a manual", c.manual.ventas === 1, c.manual);
    }
    const total = r.canales.reduce((a, x) => a + x.boletas, 0);
    chequear("la rechazada no cuenta en ningún canal", total === 16, total);
    chequear("siempre vuelven los tres canales", r.canales.length === 3);

    const dias = r.serieBot.reduce((a, d) => a + d.boletas, 0);
    chequear("la serie del bot suma sus boletas", dias === 8, r.serieBot);
    chequear("la serie separa los días", r.serieBot.length === 2, r.serieBot);

    const hoy = new Date().toISOString().slice(0, 10);
    const soloHoy = await cargarVentasPorCanal(pool as never, "mggroup", EMP, SOR, {
      desdeIso: `${hoy}T00:00:00.000Z`,
    });
    const botHoy = soloHoy.canales.find((x) => x.canal === "bot")!;
    chequear("el filtro de fecha deja afuera la de hace 3 días", botHoy.boletas === 3, botHoy);

    await db.close();
  }
  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
