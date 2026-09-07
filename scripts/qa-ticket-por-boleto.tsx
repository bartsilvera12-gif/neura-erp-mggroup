/**
 * Pruebas del boleto térmico: formato y una hoja por número.
 *
 * Correr con: npx tsx scripts/qa-ticket-por-boleto.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TicketTermico from "@/components/sorteos/TicketTermico";
import { CONFIG_TICKET_DEFECTO, type DatosTicket } from "@/lib/sorteos/ticket-impresion-tipos";

const QR_FALSO = "data:image/png;base64,iVBORw0KGgo=";

const datos: DatosTicket = {
  entrada_id: "x",
  numero_orden: 48,
  fecha: "2026-09-07T14:30:00.000Z",
  cliente: "Juan Gómez",
  documento: "4567890",
  telefono: "0981123456",
  ciudad: "Encarnación",
  cantidad: 3,
  monto: 30000,
  pago_metodo: "efectivo",
  cupones: ["4827", "7154", "5390"],
  sorteo_nombre: "Nissan Frontier",
  vendedor_nombre: "Carlos Benítez",
  vendedor_numero: 3,
  qr_por_cupon: { "4827": QR_FALSO, "7154": QR_FALSO, "5390": QR_FALSO },
};

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
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
  chequear(`hoja ${i + 1}: lleva su número`, t.includes(`NRO: ${datos.cupones[i]}`), t);
  chequear(`hoja ${i + 1}: no lleva los otros`, otros.every((c) => !t.includes(c)), t);
  chequear(`hoja ${i + 1}: dice de cuál de los tres es`, t.includes(`Boleto ${i + 1}/3`), t);
  chequear(`hoja ${i + 1}: cobra un boleto`, t.includes("10.000 Gs."), t);
  chequear(`hoja ${i + 1}: aclara la compra entera`, t.includes("compra de 3 boletos 30.000 Gs."), t);
  chequear(`hoja ${i + 1}: mantiene la orden`, t.includes("N.º 48"), t);
  chequear(`hoja ${i + 1}: lleva su QR`, html.includes(QR_FALSO), "sin img de QR");
  if (i === 0) console.log("\n  --- hoja 1 ---\n  " + t + "\n");
}

console.log("Formato de la boleta (lo que pidió el cliente)");
{
  const t = texto(
    renderToStaticMarkup(
      <TicketTermico
        cfg={CONFIG_TICKET_DEFECTO}
        datos={datos}
        boleto={{ n: 1, de: 3, numero: "4827", monto: 10000 }}
      />
    )
  );
  chequear("documento y celular en una sola línea", t.includes("CI: 4567890 | Cel: 0981123456"), t);
  chequear("edición con el precio del boleto", t.includes("EDICIÓN: NISSAN FRONTIER A: 10.000 GS."), t);
  chequear("la ciudad, en lugar de la rayita", t.includes("CIUDAD: ENCARNACIÓN"), t);
  chequear("el nombre del comprador", t.includes("Juan Gómez"), t);
}

console.log("Sin ciudad se mantiene la separación");
{
  const html = renderToStaticMarkup(
    <TicketTermico
      cfg={CONFIG_TICKET_DEFECTO}
      datos={{ ...datos, ciudad: null }}
      boleto={{ n: 1, de: 3, numero: "4827", monto: 10000 }}
    />
  );
  chequear("no imprime «CIUDAD:» vacío", !texto(html).includes("CIUDAD:"), texto(html));
  chequear("deja la línea punteada", html.includes("border-dashed"), "sin línea");
}

console.log("Compra de 1 boleto");
{
  const uno: DatosTicket = { ...datos, cantidad: 1, monto: 10000, cupones: ["4827"] };
  const t = texto(renderToStaticMarkup(<TicketTermico cfg={CONFIG_TICKET_DEFECTO} datos={uno} />));
  chequear("no dice de cuál boleto es", !t.includes("Boleto 1/"), t);
  chequear("no repite el total de la compra", !t.includes("compra de"), t);
  chequear("cobra el total", t.includes("10.000 Gs."), t);
}

console.log("Sin QR el boleto igual sale");
{
  const sinQr: DatosTicket = { ...datos, qr_por_cupon: {} };
  const html = renderToStaticMarkup(
    <TicketTermico
      cfg={CONFIG_TICKET_DEFECTO}
      datos={sinQr}
      boleto={{ n: 1, de: 3, numero: "4827", monto: 10000 }}
    />
  );
  chequear("no rompe", texto(html).includes("NRO: 4827"), texto(html));
  chequear("no deja una imagen rota", !html.includes("<img"), html);
}

console.log("Papel de 58 mm: el QR va abajo, no al lado del logo");
{
  const html = renderToStaticMarkup(
    <TicketTermico
      cfg={{ ...CONFIG_TICKET_DEFECTO, ancho_mm: 58, logo_url: "https://ejemplo/logo.png" }}
      datos={datos}
      boleto={{ n: 1, de: 3, numero: "4827", monto: 10000 }}
    />
  );
  const iLogo = html.indexOf("https://ejemplo/logo.png");
  const iQr = html.indexOf(QR_FALSO);
  chequear("los dos están", iLogo >= 0 && iQr >= 0, { iLogo, iQr });
  chequear("el QR va después del logo", iQr > iLogo, { iLogo, iQr });
  chequear("el QR aparece una sola vez", html.split(QR_FALSO).length - 1 === 1, html);
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
