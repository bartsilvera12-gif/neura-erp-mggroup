/**
 * Compradores con documento o teléfono de otro país.
 *
 * Lo que se verifica: que un pasaporte o un documento extranjero pase el paso del documento,
 * que un número de otro país pase el del teléfono, y que los datos paraguayos sigan entrando
 * igual que antes —sin perder ceros ni aceptar basura—.
 *
 * Correr con: npx tsx scripts/qa-extranjeros.ts
 */
import { checkFlowInput, flowInputInvalidMessage } from "@/lib/chat/flow-input-validation";
import { toTelefonoLocalPy } from "@/lib/chat/flow-telefono-vars";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

const doc = (v: string) => checkFlowInput(v, "documento");
const tel = (v: string) => checkFlowInput(v, "telefono");
const valor = (r: ReturnType<typeof checkFlowInput>) => (r.ok ? r.value : null);

console.log("\nDocumento: entra lo que antes quedaba afuera");
{
  chequear("pasaporte con letras", valor(doc("AB1234567")) === "AB1234567", doc("AB1234567"));
  chequear("pasaporte en minúscula queda en mayúscula", valor(doc("ab1234567")) === "AB1234567");
  chequear("CPF brasileño con puntos y guion", valor(doc("123.456.789-09")) === "123456789-09", doc("123.456.789-09"));
  chequear("DNI argentino", valor(doc("35123456")) === "35123456");
  chequear("RUC con dígito verificador", valor(doc("80148499-5")) === "80148499-5");
  chequear("documento que empieza con cero no pierde el cero", valor(doc("0123456")) === "0123456");
}

console.log("\nDocumento: la cédula paraguaya sigue entrando igual");
{
  chequear("cédula sola", valor(doc("4567890")) === "4567890");
  chequear("cédula con puntos", valor(doc("4.567.890")) === "4567890");
  chequear("cédula con espacios", valor(doc(" 4 567 890 ")) === "4567890");
}

console.log("\nDocumento: lo que no es un documento se repregunta");
{
  for (const basura of ["no tengo", "después", "ok", "123", "hola que tal", "AB12!34"]) {
    const r = doc(basura);
    chequear(`«${basura}»`, !r.ok && r.reason === "not_a_document", r);
  }
  const msg = flowInputInvalidMessage(null, "not_a_document");
  chequear("el mensaje menciona el pasaporte", /pasaporte/i.test(msg), msg);
}

console.log("\nTeléfono: números de cualquier país");
{
  chequear("argentino con + y espacios", valor(tel("+54 9 11 2345-6789")) === "5491123456789", tel("+54 9 11 2345-6789"));
  chequear("brasileño con paréntesis", valor(tel("+55 (11) 91234-5678")) === "5511912345678");
  chequear("español", valor(tel("+34 612 34 56 78")) === "34612345678");
  chequear("paraguayo local conserva el 0", valor(tel("0981123456")) === "0981123456");
  chequear("paraguayo con código", valor(tel("+595 981 123456")) === "595981123456");
  for (const basura of ["no sé", "12345", "0981abc123", "1234567890123456"]) {
    const r = tel(basura);
    chequear(`rechaza «${basura}»`, !r.ok && r.reason === "not_a_phone", r);
  }
}

console.log("\nCómo sale el teléfono en la boleta");
{
  const casos: Array<[string, string]> = [
    ["595981123456", "0981123456"],
    ["5491123456789", "+5491123456789"],
    ["5511912345678", "+5511912345678"],
    ["34612345678", "+34612345678"],
    ["0981123456", "0981123456"],
    ["981123456", "981123456"],
    ["", ""],
  ];
  for (const [entrada, esperado] of casos) {
    const r = toTelefonoLocalPy(entrada);
    chequear(`«${entrada || "vacío"}» → «${esperado || "vacío"}»`, r === esperado, r);
  }
}

console.log("\nLo que ya existía no cambia");
{
  const n = checkFlowInput("3", "number");
  chequear("la cantidad sigue validándose como número", n.ok && n.value === "3", n);
  chequear("y sigue rechazando palabras", !checkFlowInput("tres", "number").ok);
  chequear("un paso sin validación deja pasar cualquier texto", valor(checkFlowInput(" hola ", "none")) === "hola");
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
