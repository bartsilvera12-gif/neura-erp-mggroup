/**
 * ¿El comprobante es de este pago o de uno viejo?
 *
 * Alguien puede mandar la captura de una transferencia de la semana pasada, que existió de
 * verdad y que el OCR lee perfecto. La única forma de darse cuenta es la fecha: si la compra se
 * reservó hace diez minutos, un comprobante de hace una semana no es de este pago.
 */

export type FechaComprobanteEvaluacion = {
  /** null cuando no se pudo leer la fecha; ahí no se rechaza nada. */
  fecha: Date | null;
  diasDeAntiguedad: number | null;
  /** true solo cuando la fecha se leyó bien Y está fuera de la ventana permitida. */
  fueraDeVentana: boolean;
  motivo: "sin_fecha" | "dentro_de_ventana" | "demasiado_vieja" | "en_el_futuro";
};

/** Un día de gracia hacia adelante: relojes desfasados y husos horarios. */
const DIAS_DE_GRACIA_FUTURO = 1;

/**
 * Meses escritos con letras, como los abrevia cada banco.
 *
 * Banco Familiar manda «05/sept/2026» y otros «5 de septiembre de 2026». Leyendo solo fechas
 * numéricas esos comprobantes quedaban sin fecha, y por lo tanto nunca se rechazaban por
 * viejos: justo el caso que se quería cubrir.
 */
const MESES_PY: Record<string, number> = {
  ene: 1, enero: 1,
  feb: 2, febrero: 2,
  mar: 3, marzo: 3,
  abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6,
  jul: 7, julio: 7,
  ago: 8, agosto: 8,
  set: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};

function mesDesdeTexto(raw: string): number | null {
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\.$/, "");
  return MESES_PY[t] ?? null;
}

/**
 * Fecha de un comprobante paraguayo: día/mes/año.
 *
 * El orden importa y no se adivina: en Paraguay 01/09 es el 1 de septiembre, nunca el 9 de
 * enero. Interpretarlo al revés daría por vieja una transferencia de hoy.
 *
 * Devuelve null ante cualquier duda —día 32, mes 13, año imposible—. Sin fecha confiable no se
 * rechaza: es preferible dejar pasar un comprobante viejo, que alguien va a notar, antes que
 * rechazar el pago bueno de un cliente por una fecha mal leída.
 */
export function parsearFechaComprobantePy(raw: string | null | undefined): Date | null {
  const t = (raw ?? "").trim();
  if (!t) return null;

  const m = t.match(
    /^(\d{1,2})\s*(?:de\s+)?[/.\- ]\s*([A-Za-zÁÉÍÓÚáéíóú.]+|\d{1,2})\s*(?:de\s+)?[/.\- ]\s*(\d{2,4})$/
  );
  if (!m) return null;

  const dia = Number(m[1]);
  /** El mes viene en número o en letras: «05/sept/2026» es tan común como «05/09/2026». */
  const mes = /^\d+$/.test(m[2]) ? Number(m[2]) : (mesDesdeTexto(m[2]) ?? NaN);
  let anio = Number(m[3]);
  if (!Number.isFinite(dia) || !Number.isFinite(mes) || !Number.isFinite(anio)) return null;
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;

  /** Año de dos dígitos: 26 es 2026. Un comprobante nunca es del siglo pasado. */
  if (anio < 100) anio += 2000;
  if (anio < 2000 || anio > 2100) return null;

  const d = new Date(Date.UTC(anio, mes - 1, dia));
  /** Rebote del 31 de un mes de 30: Date lo corre al mes siguiente en vez de fallar. */
  if (d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1) return null;
  return d;
}

/** Días completos entre la fecha del comprobante y hoy (positivo = comprobante viejo). */
function diasDeDiferencia(fecha: Date, ahora: Date): number {
  const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  return Math.round((hoy - fecha.getTime()) / 86_400_000);
}

export function evaluarFechaComprobante(input: {
  fechaOcr: string | null | undefined;
  maxDiasAntiguedad: number;
  ahora?: Date;
}): FechaComprobanteEvaluacion {
  const fecha = parsearFechaComprobantePy(input.fechaOcr);
  if (!fecha) {
    return { fecha: null, diasDeAntiguedad: null, fueraDeVentana: false, motivo: "sin_fecha" };
  }

  const dias = diasDeDiferencia(fecha, input.ahora ?? new Date());

  if (dias < -DIAS_DE_GRACIA_FUTURO) {
    return { fecha, diasDeAntiguedad: dias, fueraDeVentana: true, motivo: "en_el_futuro" };
  }
  if (dias > Math.max(0, Math.trunc(input.maxDiasAntiguedad))) {
    return { fecha, diasDeAntiguedad: dias, fueraDeVentana: true, motivo: "demasiado_vieja" };
  }
  return { fecha, diasDeAntiguedad: dias, fueraDeVentana: false, motivo: "dentro_de_ventana" };
}
