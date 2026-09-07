import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TicketTermico from "@/components/sorteos/TicketTermico";
import { CONFIG_TICKET_DEFECTO, type DatosTicket } from "@/lib/sorteos/ticket-impresion-tipos";

const datos: DatosTicket = {
  entrada_id: "x", numero_orden: 48, fecha: "2026-09-07T14:30:00.000Z",
  cliente: "Juan Gómez", documento: "4567890", telefono: "0981123456",
  ciudad: "Encarnación", cantidad: 3, monto: 30000, pago_metodo: "efectivo",
  cupones: ["4827", "7154", "5390"], sorteo_nombre: "Nissan Frontier",
  vendedor_nombre: "Carlos Benítez", vendedor_numero: 3,
};

const texto = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else { fallas++; console.log("  FALLA " + n, d ?? ""); }
};

console.log("\nCompra de 3 boletos: una hoja por número");
for (let i = 0; i < 3; i++) {
  const html = renderToStaticMarkup(
    <TicketTermico
      cfg={CONFIG_TICKET_DEFECTO}
      datos={datos}
      boleto={{ n: i + 1, de: 3, numero: datos.cupones[i], monto: 10000 }}
    />
  );
  const t = texto(html);
  const otros = datos.cupones.filter((_, j) => j !== i);
  chequear(`hoja ${i + 1}: lleva su número`, t.includes(datos.cupones[i]), t);
  chequear(`hoja ${i + 1}: no lleva los otros`, otros.every((c) => !t.includes(c)), t);
  chequear(`hoja ${i + 1}: dice "Boleto ${i + 1} de 3"`, t.includes(`Boleto ${i + 1} de 3`), t);
  chequear(`hoja ${i + 1}: cobra un boleto`, t.includes("Gs. 10.000"), t);
  chequear(`hoja ${i + 1}: aclara la compra`, t.includes("Compra de 3 boletos"), t);
  chequear(`hoja ${i + 1}: mantiene la orden`, t.includes("TICKET N.º 48"), t);
  chequear(`hoja ${i + 1}: mantiene la ciudad`, t.includes("Encarnación"), t);
  if (i === 0) console.log("\n  --- hoja 1 ---\n  " + t + "\n");
}

console.log("Compra de 1 boleto: sale como antes");
{
  const uno: DatosTicket = { ...datos, cantidad: 1, monto: 10000, cupones: ["4827"] };
  const t = texto(renderToStaticMarkup(<TicketTermico cfg={CONFIG_TICKET_DEFECTO} datos={uno} />));
  chequear("no dice «Boleto x de y»", !t.includes("Boleto 1 de"), t);
  chequear("no repite el total de la compra", !t.includes("Compra de"), t);
  chequear("cobra el total", t.includes("Gs. 10.000"), t);
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
