/**
 * Tipos compartidos del ticket térmico.
 *
 * Viven acá y no en `ticket-impresion-pg` porque los usa el componente del ticket, que es de
 * cliente: ese módulo es `server-only` y arrastrarlo al navegador rompe el build.
 */

export type ConfigTicket = {
  ancho_mm: 58 | 80;
  negocio_nombre: string;
  logo_url: string;
  encabezado: string;
  pie: string;
  mostrar_telefono: boolean;
  mostrar_vendedor: boolean;
  copias: number;
};

export const CONFIG_TICKET_DEFECTO: ConfigTicket = {
  ancho_mm: 80,
  negocio_nombre: "",
  logo_url: "",
  encabezado: "",
  pie: "¡Gracias por tu compra!",
  mostrar_telefono: true,
  mostrar_vendedor: true,
  copias: 1,
};

export type DatosTicket = {
  entrada_id: string;
  numero_orden: number | null;
  fecha: string | null;
  cliente: string;
  documento: string | null;
  telefono: string | null;
  cantidad: number;
  monto: number;
  pago_metodo: string | null;
  cupones: string[];
  sorteo_nombre: string;
  vendedor_nombre: string | null;
  vendedor_numero: number | null;
};
