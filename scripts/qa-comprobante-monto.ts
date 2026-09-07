/**
 * Pruebas del control de monto del comprobante.
 *
 * El agujero que cierran: cuando la cantidad se pide por texto («respondé con el número»), el
 * flujo no guarda ningún campo `monto`, así que la comparación se salteaba en silencio y un
 * comprobante por menos plata pasaba como válido. Ahora el total se recalcula como
 * cantidad × precio del sorteo.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobante-monto.ts
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { buildMontoCalculadoVars, MONTO_CALCULADO_KEYS } from "@/lib/chat/flow-monto-calculado";
import { validateReceiptAmountAgainstFlow } from "@/lib/chat/comprobante-monto-flow-validation";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

/**
 * Supabase de mentira: devuelve lo que se le indique por tabla y acepta cualquier cadena de
 * `.select().eq().order()…`, que es lo único que usan las funciones que se prueban acá.
 */
function supabaseFalso(porTabla: Record<string, unknown>): AppSupabaseClient {
  const encadenable = (resultado: unknown): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "not", "is"]) {
      obj[m] = () => obj;
    }
    obj.limit = () => Promise.resolve(resultado);
    obj.maybeSingle = () => Promise.resolve(resultado);
    obj.then = (res: (v: unknown) => unknown) => Promise.resolve(resultado).then(res);
    return obj;
  };
  return {
    from: (tabla: string) => encadenable(porTabla[tabla] ?? { data: null, error: null }),
  } as unknown as AppSupabaseClient;
}

async function main() {

const CON_SORTEO = {
  chat_flows: { data: [{ sorteo_id: "s1", updated_at: "2026-09-07" }], error: null },
  sorteos: { data: { precio_por_boleto: 10000 }, error: null },
};

console.log("\nTotal esperado cuando el flujo no guardó ningún monto");
{
  const casos: Array<[string, Record<string, string>, number | null]> = [
    ["2 boletos a 10.000", { cantidad: "2" }, 20000],
    ["1 boleto", { cantidad: "1" }, 10000],
    ["10 boletos", { cantidad: "10" }, 100000],
    ["clave alternativa", { cantidad_boletos: "3" }, 30000],
    ["sin cantidad todavía", {}, null],
    ["cantidad inválida", { cantidad: "abc" }, null],
    ["cantidad cero", { cantidad: "0" }, null],
  ];
  for (const [nombre, flowData, esperado] of casos) {
    const vars = await buildMontoCalculadoVars({
      supabase: supabaseFalso(CON_SORTEO),
      empresaId: "e1",
      flowCode: "sorteo",
      flowData,
    });
    const total = vars[MONTO_CALCULADO_KEYS.total];
    const obtenido = total ? Number(total) : null;
    chequear(nombre, obtenido === esperado, { obtenido, esperado });
  }
}

console.log("\nUn monto de promo ya guardado tiene prioridad");
{
  const vars = await buildMontoCalculadoVars({
    supabase: supabaseFalso(CON_SORTEO),
    empresaId: "e1",
    flowCode: "sorteo",
    flowData: { cantidad: "3", monto: "25000" },
  });
  chequear("no pisa el monto de promo", vars[MONTO_CALCULADO_KEYS.monto] === undefined, vars);
}

console.log("\nLa comparación contra el comprobante");
{
  const validar = (esperado: number | null, ocr: string, tolerancia = 0) =>
    validateReceiptAmountAgainstFlow(supabaseFalso({}), {
      flowSessionId: "sid",
      validar_monto_vs_flujo: true,
      monto_tolerancia_absoluta_gs: tolerancia,
      monto_fields_prioridad: ["monto"],
      extractedMontoString: ocr,
      precalcEsperadoGs: esperado,
    });

  const pagoDeMenos = await validar(20000, "10.000");
  chequear(
    "10.000 contra 20.000 esperados: rechaza",
    pagoDeMenos.apply && pagoDeMenos.ok === false,
    pagoDeMenos.audit
  );
  chequear(
    "y deja la diferencia registrada",
    pagoDeMenos.audit.monto_validacion_diferencia_gs === 10000 &&
      pagoDeMenos.audit.monto_validacion_status === "discrepancia",
    pagoDeMenos.audit
  );

  const exacto = await validar(20000, "20.000");
  chequear("el monto justo pasa", exacto.apply && exacto.ok === true, exacto.audit);

  const dePlus = await validar(20000, "30.000");
  chequear("pagar de más también se frena", dePlus.apply && dePlus.ok === false, dePlus.audit);

  const conTolerancia = await validar(20000, "19.900", 200);
  chequear("respeta la tolerancia configurada", conTolerancia.apply && conTolerancia.ok === true);

  const sinEsperado = await validar(null, "10.000");
  chequear(
    "sin monto esperado no inventa un rechazo",
    sinEsperado.apply === false && sinEsperado.audit.monto_validacion_status === "omitido_sin_esperado",
    sinEsperado.audit
  );

  const apagado = await validateReceiptAmountAgainstFlow(supabaseFalso({}), {
    flowSessionId: "sid",
    validar_monto_vs_flujo: false,
    monto_tolerancia_absoluta_gs: 0,
    monto_fields_prioridad: ["monto"],
    extractedMontoString: "10.000",
    precalcEsperadoGs: 20000,
  });
  chequear("con la validación apagada no se mete", apagado.apply === false, apagado.audit);
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
