/**
 * De qué parte del comprobante se saca la referencia.
 *
 * Lo que importa acá: que NO agarre el número de cuenta. Una cuenta se repite en todos los
 * comprobantes de ese banco, así que guardarla como referencia hace que el sistema rechace
 * compras buenas creyendo que son el mismo pago.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-ocr-referencia-extraccion.ts
 */
import { extraerReferenciaDeComprobante } from "@/lib/chat/comprobante-validation-service";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

console.log("\nComprobante de Banco Basa (el que mandó el cliente)");
{
  const texto = [
    "Transferencia exitosa",
    "Gs. 10.000",
    "GUILLEN IVAN",
    "Banco Basa - AH-155278735",
    "MAGNO SOTELO",
    "Ueno Bank - AH-6192529160",
    "Comprobante: 5924555201",
    "Realizado el: 01/09/2026 a las 08:33",
  ].join("\n");
  chequear("saca el número de comprobante", extraerReferenciaDeComprobante(texto) === "5924555201", extraerReferenciaDeComprobante(texto));
}

console.log("\nCuando la cuenta viene rotulada y antes que la operación");
{
  const texto = [
    "Transferencia realizada",
    "Cuenta destino Nro. 2429570091",
    "Titular: Magno Sotelo",
    "Nro. de operación: 88123456",
  ].join("\n");
  const r = extraerReferenciaDeComprobante(texto);
  chequear("no agarra la cuenta", r !== "2429570091", r);
  chequear("agarra la operación", r === "88123456", r);
}

console.log("\nSi lo único rotulado es la cuenta, no devuelve nada");
{
  const texto = "Transferencia exitosa\nCuenta Nro. 2429570091\nTitular: Magno Sotelo";
  chequear("devuelve vacío", extraerReferenciaDeComprobante(texto) === "", extraerReferenciaDeComprobante(texto));
}

console.log("\nOtras formas de rotular la operación");
{
  const casos: Array<[string, string]> = [
    ["Referencia: ABC123456", "ABC123456"],
    ["Nro. de transacción 998877665", "998877665"],
    ["Número de operación: 12345678", "12345678"],
    ["COMPROBANTE 5924555201", "5924555201"],
  ];
  for (const [texto, esperado] of casos) {
    const r = extraerReferenciaDeComprobante(texto);
    chequear(`«${texto}»`, r === esperado, r);
  }
}

console.log("\nGenéricas: siguen sirviendo cuando no hay nada mejor");
{
  const r = extraerReferenciaDeComprobante("Pago realizado\nRef. 77665544\nGracias");
  chequear("«Ref. 77665544»", r === "77665544", r);
}

console.log("\nSin nada que parezca referencia");
{
  chequear("texto vacío", extraerReferenciaDeComprobante("") === "");
  chequear("texto sin etiquetas", extraerReferenciaDeComprobante("Transferencia exitosa Gs. 10.000") === "");
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
