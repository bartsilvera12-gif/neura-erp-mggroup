/**
 * Fecha del sorteo en texto para las boletas: "27 de diciembre".
 *
 * Se toma de la parte de fecha del ISO (sin convertir zona horaria), igual que el recordatorio
 * de WhatsApp, para que la boleta y el aviso digan siempre el mismo día. Sin año, como en el
 * modelo que aprobó el cliente ("Se sortea el: 27 de diciembre"). Módulo puro: lo importan
 * tanto el componente de cliente (ticket térmico) como el render server del comprobante.
 */
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function fechaSorteoTexto(iso?: string | null): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const dia = parseInt(m[3]!, 10);
  const mes = MESES[parseInt(m[2]!, 10) - 1] ?? "";
  return mes ? `${dia} de ${mes}` : "";
}
