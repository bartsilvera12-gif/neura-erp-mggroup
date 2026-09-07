"use client";

import type { ConfigTicket, DatosTicket } from "@/lib/sorteos/ticket-impresion-tipos";

const PYG = new Intl.NumberFormat("es-PY");
const gs = (n: number) => "Gs. " + PYG.format(Math.round(n || 0));

function fechaHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/**
 * Un ticket para impresora térmica.
 *
 * Se imprime desde el navegador con `@page size: <ancho>mm auto`, que es lo que hace que la
 * impresora corte al largo del contenido en vez de tirar una hoja entera. Todo va en
 * monoespaciada y blanco y negro puro: las térmicas no imprimen grises ni colores, y un texto
 * gris claro sale ilegible o directamente no sale.
 */
export default function TicketTermico({
  cfg,
  datos,
  copia,
  boleto,
}: {
  cfg: ConfigTicket;
  datos: DatosTicket;
  /** Número de copia, cuando se imprime más de una. */
  copia?: { n: number; de: number };
  /**
   * Un boleto suelto de la compra.
   *
   * Cuando alguien compra tres números, se imprimen tres tickets de un número cada uno: el
   * boleto es lo que la persona guarda o regala, y dos números en la misma hoja no se pueden
   * repartir. Sin esta prop el ticket sale con todos los números juntos, que es lo que sirve
   * para la vista previa y para una compra de un solo boleto.
   */
  boleto?: { n: number; de: number; numero: string; monto: number };
}) {
  const anchoMm = cfg.ancho_mm;
  /** Margen de 3 mm a cada lado: el área imprimible es menor que el papel. */
  const contenidoMm = anchoMm - 6;
  const numeros = boleto ? [boleto.numero] : datos.cupones;
  const monto = boleto ? boleto.monto : datos.monto;

  return (
    <div
      className="ticket-termico mx-auto bg-white font-mono text-black"
      style={{ width: `${contenidoMm}mm`, fontSize: anchoMm === 58 ? "10px" : "11px" }}
    >
      {cfg.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cfg.logo_url}
          alt=""
          className="mx-auto mb-1 block"
          style={{ maxWidth: "100%", maxHeight: "18mm", objectFit: "contain" }}
        />
      ) : null}

      <div className="text-center font-bold uppercase leading-tight">
        {cfg.negocio_nombre || datos.sorteo_nombre || "Comprobante"}
      </div>
      {cfg.encabezado && (
        <div className="whitespace-pre-line text-center leading-tight">{cfg.encabezado}</div>
      )}

      <div className="my-1 border-t border-dashed border-black" />

      <div className="text-center font-bold leading-tight">
        TICKET N.º {datos.numero_orden ?? "—"}
      </div>
      {boleto && boleto.de > 1 && (
        <div className="text-center font-bold leading-tight">
          Boleto {boleto.n} de {boleto.de}
        </div>
      )}
      <div className="text-center leading-tight">{fechaHora(datos.fecha)}</div>
      {cfg.mostrar_vendedor && datos.vendedor_numero != null && (
        <div className="text-center leading-tight">
          Vendedor N.º {datos.vendedor_numero}
          {datos.vendedor_nombre ? ` · ${datos.vendedor_nombre}` : ""}
        </div>
      )}

      <div className="my-1 border-t border-dashed border-black" />

      <div className="space-y-0.5 leading-tight">
        <Fila k="Cliente" v={datos.cliente || "—"} />
        {datos.documento && <Fila k="Doc." v={datos.documento} />}
        {cfg.mostrar_telefono && datos.telefono && <Fila k="Tel." v={datos.telefono} />}
        {datos.ciudad && <Fila k="Ciudad" v={datos.ciudad} />}
        {datos.sorteo_nombre && <Fila k="Sorteo" v={datos.sorteo_nombre} />}
        {!boleto && <Fila k="Cantidad" v={`${datos.cantidad}`} />}
        {datos.pago_metodo && <Fila k="Pago" v={datos.pago_metodo} />}
      </div>

      {numeros.length > 0 && (
        <>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="leading-tight">
            <div className="font-bold">{numeros.length === 1 ? "Número" : "Números"}</div>
            <div className="break-words font-bold" style={{ fontSize: boleto ? "1.6em" : undefined }}>
              {numeros.join("  ")}
            </div>
          </div>
        </>
      )}

      <div className="my-1 border-t border-dashed border-black" />

      <div className="flex justify-between font-bold" style={{ fontSize: "1.25em" }}>
        <span>TOTAL</span>
        <span>{gs(monto)}</span>
      </div>

      {/* La compra entera, para poder atar los boletos sueltos a la venta que los generó. */}
      {boleto && boleto.de > 1 && (
        <div className="leading-tight">
          Compra de {boleto.de} boletos · {gs(datos.monto)}
        </div>
      )}

      {cfg.pie && (
        <>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="whitespace-pre-line text-center leading-tight">{cfg.pie}</div>
        </>
      )}

      {copia && copia.de > 1 && (
        <div className="mt-1 text-center leading-tight">
          Copia {copia.n} de {copia.de}
        </div>
      )}

      {/* Alimenta papel para que el corte no quede pegado al texto. */}
      <div style={{ height: "8mm" }} />
    </div>
  );
}
