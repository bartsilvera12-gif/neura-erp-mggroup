/**
 * Cuándo una venta por WhatsApp queda confirmada sola.
 *
 * Toda compra del bot nacía en «pendiente de revisión», aunque el comprobante estuviera
 * validado y la persona ya tuviera sus boletas. Como nadie las pasaba a confirmado a mano, se
 * acumularon: en MG eran 2.358 órdenes y 43 millones cobrados que el tablero mostraba como
 * pendientes y que la impresión de cupones —que imprime solo confirmadas— dejaba afuera.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-confirmar-venta-bot.ts
 */
import { comprobanteValidadoConfirmaPago } from "@/lib/sorteos/sorteo-order-from-chat";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

console.log("\nConfirma el pago");
{
  chequear("comprobante válido", comprobanteValidadoConfirmaPago("valido"));
  chequear("aprobado a mano desde el inbox", comprobanteValidadoConfirmaPago("aprobado_manual"));
}

console.log("\nNo confirma: queda pendiente para que alguien lo mire");
{
  for (const estado of [
    "revision_manual",
    "pendiente",
    "ocr_error",
    "monto_incoherente",
    "datos_bancarios_incoherentes",
    "duplicado_hash",
    "duplicado_ocr",
    "comprobante_reenviado",
    "comprobante_vencido",
    "rechazado_manual",
  ]) {
    chequear(estado, !comprobanteValidadoConfirmaPago(estado));
  }
  /** Canal sin validación de comprobantes: nadie verificó el pago. */
  chequear("sin comprobante", !comprobanteValidadoConfirmaPago("") && !comprobanteValidadoConfirmaPago(null));
  chequear("un estado desconocido no confirma", !comprobanteValidadoConfirmaPago("lo_que_sea"));
  chequear("con espacios alrededor igual vale", comprobanteValidadoConfirmaPago("  valido  "));
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
