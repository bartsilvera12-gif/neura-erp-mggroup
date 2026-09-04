/**
 * Selección del monto en el texto OCR de un comprobante.
 *
 * No toca la base: alcanza con `npm run test:comprobante-monto`.
 *
 * El selector es heurístico y sus errores son silenciosos —guarda un número equivocado y la
 * validación igual da «valido»—, así que los formatos que ya se vieron en producción quedan
 * fijados acá. Al agregar un banco nuevo, sumar su recibo como caso.
 */
import {
  selectReceiptMontoFromOcrText,
} from "../src/lib/chat/comprobante-ocr-monto-selection";

type Caso = {
  nombre: string;
  esperado: string;
  ocr: string[];
};

const CASOS: Caso[] = [
  {
    /**
     * Caso real 2026-09-04. Se guardaba 8985550 (el nro. de comprobante) como monto de una
     * transferencia de 10.000: el `Gs.` de dos renglones abajo entraba en la ventana de
     * deteccion de moneda y empataba el puntaje de los tres numeros.
     */
    nombre: "ueno bank, nro. de comprobante antes del importe",
    esperado: "10000",
    ocr: [
      "ueno bank",
      "Comprobante de transferencia",
      "Nro. de comprobante: 8985550",
      "04/09/2026 a las 10:00",
      "Gs. 10.000",
      "Transferencia exitosa",
      "DE:",
      "JAZMIN ELIZABETH QUINTANA PALACIOS",
      "Caja de ahorro Nro. 619302991",
      "ueno bank S.A.",
      "PARA",
      "Magno Sotelo Espinola",
      "Nro. 6192529160",
    ],
  },
  {
    nombre: "moneda en un renglon y el importe en el siguiente",
    esperado: "150000",
    ocr: [
      "Transferencia realizada",
      "Monto",
      "Gs.",
      "150.000",
      "Cuenta destino: 6192529160",
      "Fecha 12/08/2026",
    ],
  },
  {
    nombre: "importe etiquetado, con nro. de operacion y cuenta",
    esperado: "250000",
    ocr: [
      "Banco Continental",
      "Operacion Nro. 445566778",
      "Monto transferido: Gs. 250.000",
      "Cuenta origen 1234567890",
      "31/07/2026 14:22",
    ],
  },
  {
    /** Los centavos se pegaban a los digitos: 1.234.567,00 daba 123456700. */
    nombre: "importe con centavos",
    esperado: "1234567",
    ocr: [
      "Comprobante",
      "Importe",
      "Gs. 1.234.567,00",
      "Nro. de cuenta 9988776655",
      "Ref: 20260904",
    ],
  },
  {
    nombre: "monto de cuatro digitos",
    esperado: "5000",
    ocr: [
      "Tigo Money",
      "Envio exitoso",
      "Total: Gs. 5.000",
      "Nro. de transaccion: 778899001",
      "05/09/2026",
    ],
  },
];

function main(): void {
  let fallas = 0;

  for (const caso of CASOS) {
    const r = selectReceiptMontoFromOcrText(caso.ocr.join("\n"), {});
    const ok = r.monto === caso.esperado;
    if (ok) {
      console.log(`OK    ${caso.nombre} -> ${r.monto}`);
      continue;
    }
    fallas += 1;
    console.error(`FALLA ${caso.nombre}`);
    console.error(`      esperado "${caso.esperado}", eligio "${r.monto}"`);
    console.error(`      motivo: ${r.audit.chosen_reason}`);
    for (const c of r.audit.candidates.slice(0, 6)) {
      console.error(`        ${c.digits_masked} puntaje=${c.score} ${c.flags.join(",")}`);
    }
  }

  console.log("");
  if (fallas > 0) {
    console.error(`${fallas} de ${CASOS.length} casos fallan.`);
    process.exit(1);
  }
  console.log(`${CASOS.length} casos pasan.`);
}

main();
