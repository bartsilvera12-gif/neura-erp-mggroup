"use client";

import type { ConfigTicket, DatosTicket } from "@/lib/sorteos/ticket-impresion-tipos";

const PYG = new Intl.NumberFormat("es-PY");
const gs = (n: number) => PYG.format(Math.round(n || 0)) + " Gs.";

function fechaHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Un boleto para impresora térmica.
 *
 * El formato es el de la boleta que se manda por WhatsApp —logo, nombre del comprador,
 * documento y celular en una línea, edición, número y ciudad— para que la boleta impresa y la
 * digital se lean igual. Antes era una lista de «campo: valor» con el total y la forma de
 * pago, que es un comprobante de caja, no un boleto de sorteo.
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
   * Cuando alguien compra tres números, se imprimen tres boletos de un número cada uno: el
   * boleto es lo que la persona guarda o regala, y dos números en la misma hoja no se pueden
   * repartir. Sin esta prop salen todos los números juntos, que es lo que sirve para la vista
   * previa de la configuración.
   */
  boleto?: { n: number; de: number; numero: string; monto: number };
}) {
  const anchoMm = cfg.ancho_mm;
  /** Margen de 3 mm a cada lado: el área imprimible es menor que el papel. */
  const contenidoMm = anchoMm - 6;
  const angosto = anchoMm === 58;

  const numeros = boleto ? [boleto.numero] : datos.cupones;
  const numeroPrincipal = numeros[0] ?? "";
  const montoBoleto = boleto ? boleto.monto : datos.monto;
  /** Precio de un boleto: es lo que dice la edición, no lo que pagó por toda la compra. */
  const precioUnitario =
    datos.cantidad > 0 ? Math.round(datos.monto / datos.cantidad) : datos.monto;
  const qr = numeroPrincipal ? datos.qr_por_cupon?.[numeroPrincipal] : undefined;

  const contacto = [
    datos.documento ? `CI: ${datos.documento}` : "",
    cfg.mostrar_telefono && datos.telefono ? `Cel: ${datos.telefono}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const edicion = [datos.sorteo_nombre, precioUnitario > 0 ? `A: ${gs(precioUnitario)}` : ""]
    .filter(Boolean)
    .join(" ");

  const logo = cfg.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cfg.logo_url}
      alt=""
      className="block"
      style={{ maxWidth: "100%", maxHeight: angosto ? "12mm" : "14mm", objectFit: "contain" }}
    />
  ) : (
    <div className="font-bold uppercase leading-tight">{cfg.negocio_nombre || ""}</div>
  );

  const qrImg = qr ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={qr}
      alt=""
      className="block"
      style={{ width: angosto ? "22mm" : "20mm", height: angosto ? "22mm" : "20mm" }}
    />
  ) : null;

  return (
    <div
      className="ticket-termico mx-auto bg-white font-mono text-black"
      style={{ width: `${contenidoMm}mm`, fontSize: angosto ? "10px" : "11px" }}
    >
      {/*
        En 80 mm entra el logo a la izquierda y el QR a la derecha, como la boleta impresa desde
        la computadora. En 58 mm no entran los dos al lado: el logo va arriba y el QR abajo,
        igual que en la boleta que se manda por WhatsApp.
      */}
      {angosto ? (
        (cfg.logo_url || cfg.negocio_nombre) && (
          <div className="mb-1 flex justify-center">{logo}</div>
        )
      ) : (
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{logo}</div>
          {qrImg}
        </div>
      )}

      {cfg.encabezado && (
        <div className="whitespace-pre-line text-center leading-tight">{cfg.encabezado}</div>
      )}

      <div className="text-center font-bold leading-tight" style={{ fontSize: "1.3em" }}>
        {datos.cliente || "—"}
      </div>

      {contacto && <div className="text-center leading-tight">{contacto}</div>}

      <div className="mt-1 break-words font-bold leading-tight">
        EDICIÓN: {edicion.toUpperCase() || "—"}
      </div>

      <div className="font-bold leading-tight" style={{ fontSize: "1.6em" }}>
        NRO: {numeros.join("  ") || "—"}
      </div>

      {/*
        La ciudad va donde la boleta tenía la línea punteada. Cuando no hay ciudad se deja la
        línea: sin nada, el número y el pie quedan pegados en un solo bloque.
      */}
      {datos.ciudad ? (
        <div className="font-bold leading-tight">CIUDAD: {datos.ciudad.toUpperCase()}</div>
      ) : (
        <div className="my-1 border-t border-dashed border-black" />
      )}

      {angosto && qrImg && <div className="mt-1 flex justify-center">{qrImg}</div>}

      {/*
        Datos de control, chicos y al final: el boleto es del comprador, pero el vendedor
        necesita poder atar el papel a la venta cuando rinde la caja.
      */}
      <div className="mt-1 leading-tight">
        <div>
          N.º {datos.numero_orden ?? "—"} · {fechaHora(datos.fecha)}
          {boleto && boleto.de > 1 ? ` · Boleto ${boleto.n}/${boleto.de}` : ""}
        </div>
        {cfg.mostrar_vendedor && datos.vendedor_numero != null && (
          <div>
            Vendedor N.º {datos.vendedor_numero}
            {datos.vendedor_nombre ? ` · ${datos.vendedor_nombre}` : ""}
          </div>
        )}
        {boleto && boleto.de > 1 ? (
          <div>
            {gs(montoBoleto)} · compra de {boleto.de} boletos {gs(datos.monto)}
          </div>
        ) : (
          <div>{gs(montoBoleto)}</div>
        )}
      </div>

      {cfg.pie && (
        <div className="mt-1 whitespace-pre-line text-center leading-tight">{cfg.pie}</div>
      )}

      {copia && copia.de > 1 && (
        <div className="text-center leading-tight">
          Copia {copia.n} de {copia.de}
        </div>
      )}

      {/* Alimenta papel para que el corte no quede pegado al texto. */}
      <div style={{ height: "8mm" }} />
    </div>
  );
}
