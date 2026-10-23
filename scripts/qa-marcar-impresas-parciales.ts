/**
 * Marcar una tanda como impresa cuando el rango de números parte compras al medio.
 *
 * El caso real: MG imprimió «del cupón 1 al 8.312». La impresión filtra por número de boleta,
 * pero la marca de impresa se guarda por compra entera. Había 388 compras con boletas dentro y
 * fuera de ese rango: marcarlas enteras dejaba 439 boletas sin imprimir para siempre, porque
 * con «Solo no impresas» ya no volvían a salir.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-marcar-impresas-parciales.ts
 */
import {
  alinearImpresas,
  separarCompletasYParciales,
} from "@/lib/sorteos/sorteo-entrada-confirmar-impresion-bulk";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

/**
 * Compras de la tanda, con los números que les tocaron y cuántas entraron en el rango 1..8312:
 *  - 101: 4000 y 4100  → las dos adentro (completa)
 *  - 102: 4500 y 9800  → una adentro, una afuera (el caso del problema)
 *  - 104: 5000         → una sola, adentro (completa)
 */
const TOTALES = [
  { id: "c1", numero_orden: 101, total: 2 },
  { id: "c2", numero_orden: 102, total: 2 },
  { id: "c4", numero_orden: 104, total: 1 },
];
const IMPRESAS = new Map([
  ["c1", 2],
  ["c2", 1],
  ["c4", 1],
]);

console.log("\nTanda del cupón 1 al 8.312");
{
  const r = separarCompletasYParciales(TOTALES, IMPRESAS);
  chequear("marca solo las compras impresas completas", [...r.completas].sort().join() === "c1,c4", r.completas);
  chequear("deja sin marcar la compra partida", r.parciales.length === 1 && r.parciales[0].numero_orden === 102, r.parciales);
  chequear(
    "y dice cuántas boletas le faltan",
    r.parciales[0].impresas === 1 && r.parciales[0].total === 2,
    r.parciales[0]
  );
}

console.log("\nSegunda tanda, ya sin cortar por rango");
{
  const r = separarCompletasYParciales(
    [{ id: "c2", numero_orden: 102, total: 2 }],
    new Map([["c2", 2]])
  );
  chequear("ahora sí se marca", r.completas.has("c2") && r.parciales.length === 0, r);
}

console.log("\nCasos de borde");
{
  const ninguna = separarCompletasYParciales(TOTALES, new Map([["c1", 1], ["c2", 1], ["c4", 0]]));
  chequear("si ninguna salió completa, no se marca ninguna", ninguna.completas.size === 0 && ninguna.parciales.length === 3, ninguna);

  const sinDato = separarCompletasYParciales(TOTALES, new Map());
  chequear("una compra sin conteo cuenta como no impresa", sinDato.completas.size === 0, sinDato);

  const deMas = separarCompletasYParciales([{ id: "c1", numero_orden: 101, total: 2 }], new Map([["c1", 5]]));
  chequear("si el conteo viene de más, igual se marca", deMas.completas.has("c1"), deMas);

  const sinBoletas = separarCompletasYParciales([{ id: "c9", numero_orden: 109, total: 0 }], new Map([["c9", 0]]));
  chequear("una compra sin boletas no queda como parcial", sinBoletas.completas.has("c9") && sinBoletas.parciales.length === 0);

  const desordenadas = separarCompletasYParciales(
    [
      { id: "b", numero_orden: 300, total: 2 },
      { id: "a", numero_orden: 200, total: 2 },
    ],
    new Map([["a", 1], ["b", 1]])
  );
  chequear(
    "las parciales salen ordenadas por número de orden",
    desordenadas.parciales.map((p) => p.numero_orden).join() === "200,300",
    desordenadas.parciales
  );
}

console.log("\nCómo se alinea el conteo que manda la pantalla");
{
  const ok = alinearImpresas(["c1", "c2"], ["c1", "c2"], [2, 1]);
  chequear("cada compra con su cantidad", ok?.get("c1") === 2 && ok?.get("c2") === 1, ok);

  chequear("sin el dato: se marca como antes", alinearImpresas(["c1"], ["c1"], null) === null);
  chequear("lista vacía: se marca como antes", alinearImpresas(["c1"], ["c1"], []) === null);
  chequear(
    "si falta el conteo de alguna, no se arriesga: marca todo",
    alinearImpresas(["c1", "c2"], ["c1", "c2"], [2]) === null
  );
  chequear(
    "un conteo inválido tampoco decide por su cuenta",
    alinearImpresas(["c1", "c2"], ["c1", "c2"], [2, Number.NaN]) === null
  );

  /** Si la misma compra viene repetida, vale la cantidad más alta. */
  const repetida = alinearImpresas(["c1", "c1"], ["c1"], [1, 2]);
  chequear("compra repetida en el pedido: se queda con la mayor", repetida?.get("c1") === 2, repetida);
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
