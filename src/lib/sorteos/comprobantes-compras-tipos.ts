/**
 * Tipos y reglas de la pantalla de comprobantes, sin dependencias de servidor: los usan tanto
 * la consulta como la página.
 */

export type EstadoFiltroComprobantes = "todos" | "pendientes" | "aprobados" | "rechazados";

/** Estados del comprobante que ya no esperan a nadie. */
export const ESTADOS_COMPROBANTE_APROBADO = ["valido", "aprobado_manual"] as const;
export const ESTADO_COMPROBANTE_RECHAZADO = "rechazado_manual";

export type FilaComprobanteCompra = {
  tipo: "comprobante" | "compra_sin_comprobante";
  /** Id del comprobante, o de la compra si no tiene comprobante. */
  id: string;
  fecha: string;
  validacion_id: string | null;
  estado_validacion: string | null;
  motivo_validacion: string | null;
  comprobante_url: string | null;
  monto_comprobante: number | null;
  monto_esperado: number | null;
  referencia: string | null;
  banco: string | null;
  aprobacion_manual_at: string | null;
  aprobacion_manual_nota: string | null;
  conversation_id: string | null;
  contacto_nombre: string | null;
  telefono: string | null;
  /** Nombre y documento: los de la compra, o los que cargó en el chat si todavía no hay compra. */
  nombre: string | null;
  documento: string | null;
  entrada_id: string | null;
  numero_orden: string | null;
  sorteo_nombre: string | null;
  monto_compra: number | null;
  estado_pago: string | null;
  cantidad_boletos: number | null;
  boletas: string[];
  canal: "bot" | "vendedor" | "manual" | null;
};

export type ResumenBusqueda = {
  comprobantes: number;
  pendientes: number;
  compras: number;
  boletas: number;
  monto_compras: number;
};

/**
 * Qué se busca. Con dígitos se prueba teléfono (últimos 8, para que ande con o sin 595 y con o
 * sin el 0), documento, número de boleta, número de orden y referencia del comprobante; con
 * letras, el nombre. En los comprobantes sin compra, el nombre y la cédula salen de lo que la
 * persona escribió en el chat.
 */
export function prepararBusqueda(q: string | null | undefined): {
  texto: string | null;
  digitos: string | null;
  ultimos8: string | null;
} {
  const texto = (q ?? "").trim().replace(/\s+/g, " ");
  if (!texto) return { texto: null, digitos: null, ultimos8: null };
  const digitos = texto.replace(/\D/g, "");
  const soloNumero = /^[\d\s().+-]+$/.test(texto) && digitos.length > 0;
  return {
    texto,
    digitos: soloNumero ? digitos : null,
    ultimos8: soloNumero && digitos.length >= 7 ? digitos.slice(-8) : null,
  };
}

/**
 * Un comprobante que no generó boletas y que nadie rechazó: es lo que hay que resolver a mano.
 *
 * Incluye los que el bot dio por **válidos** pero igual se quedaron sin compra: el pago entró,
 * la persona no tiene nada y es justo el caso que hay que poder destrabar (Diego Cardozo,
 * 24/09/2026). Antes se los daba por terminados y la fila no ofrecía «Aprobar».
 */
export function esComprobantePendiente(f: Pick<FilaComprobanteCompra, "tipo" | "entrada_id" | "estado_validacion">): boolean {
  return f.tipo === "comprobante" && !f.entrada_id && f.estado_validacion !== "rechazado_manual";
}

/** Lo que se le manda a la persona al rechazar su comprobante, si no se escribe otra cosa. */
export const MENSAJE_RECHAZO_POR_DEFECTO =
  "Hola 👋 Revisamos tu comprobante y no pudimos validarlo. Si ya hiciste el pago, respondé este mensaje con el comprobante correcto y lo vemos.";
