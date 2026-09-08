/**
 * Qué referencias del OCR sirven para bloquear un comprobante repetido.
 *
 * Bloquear de más es peor que bloquear de menos: un comprobante repetido que pasa se revisa a
 * mano, pero una compra buena rechazada es un cliente que se va. Por eso lo que se prueba acá
 * es sobre todo qué NO tiene que bloquear.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-ocr-referencia.ts
 */
import { ocrReferenceUsableForStrongDuplicate } from "@/lib/chat/comprobante-ocr-strong-dup-ref";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

const sirve = (r: string) => ocrReferenceUsableForStrongDuplicate(r) !== null;

console.log("\nEtiquetas que el OCR agarra de más: no bloquean");
for (const basura of [
  "BENEFICIARIO",
  "TRANSFERENCIA",
  "COMPROBANTE",
  "OPERACION",
  "CONCEPTO",
  "DATOS DE LA CUENTA",
  "TRANSFERENCIA EXITOSA",
]) {
  chequear(`«${basura}»`, !sirve(basura));
}

console.log("\nReferencias cortas: tampoco");
for (const corta of ["707891", "2539912"]) {
  chequear(`«${corta}» (${corta.length} caracteres)`, !sirve(corta));
}

console.log("\nReferencias largas de verdad: sí bloquean");
for (const buena of ["0000006192529160", "5924555201", "118765034", "TRX-987654321012"]) {
  chequear(`«${buena}»`, sirve(buena));
}

console.log("\nCasos borde");
{
  chequear("vacío", !sirve(""));
  chequear("nulo", ocrReferenceUsableForStrongDuplicate(null) === null);
  chequear("solo espacios", !sirve("            "));
  /** Larga pero casi sin dígitos: es texto, no un número de operación. */
  chequear("«NRO DE OPERACION»", !sirve("NRO DE OPERACION"));
  chequear("«REF 12345»", !sirve("REF 12345"));
  chequear("se normaliza a mayúsculas", ocrReferenceUsableForStrongDuplicate("trx-987654321012") === "TRX-987654321012");
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
