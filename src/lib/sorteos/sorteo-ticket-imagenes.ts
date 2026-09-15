/**
 * Seguimiento de cada imagen de boleto por separado.
 *
 * Una compra de varios boletos se manda como una foto por boleto, pero la fila de entrega
 * guardaba un solo estado para todas. Que Meta acepte el envío no quiere decir que la foto
 * llegue: la entrega se confirma después, por webhook, y puede volver `failed`. Con un estado
 * único, una compra de tres boletos quedaba como «enviada» aunque la tercera foto no llegara
 * nunca (orden 313).
 *
 * Acá vive la lista de imágenes que se guarda en `payload_snapshot.imagenes`, sin tocar el
 * esquema de la tabla. Todo es puro para poder probarlo sin base ni WhatsApp.
 */

/**
 * `aceptado`: Meta devolvió el id del mensaje, todavía no avisó nada más.
 * `sent`, `delivered`, `read`, `failed`: lo que avisa Meta por webhook.
 */
export type EstadoImagenBoleto = "aceptado" | "sent" | "delivered" | "read" | "failed";

export type ImagenBoleto = {
  /** Posición en la compra: boleto `n` de `de`. */
  n: number;
  de: number;
  /** Número del boleto (o los números, si la compra se mandó en una sola imagen). */
  numero: string;
  storage_path: string;
  /** Pie con el que se mandó; se reusa tal cual al reenviar. */
  pie: string;
  wa_message_id: string | null;
  estado: EstadoImagenBoleto;
  /** Envíos hechos de esta imagen, contando el primero. */
  envios: number;
  error_code?: string | null;
  error?: string | null;
  actualizado_at?: string;
};

/**
 * Cuántas veces se reintenta sola una imagen que Meta marcó como fallida. Una: si la falla
 * fue pasajera alcanza; si vuelve a fallar hay algo de fondo y repetir no ayuda.
 */
export const REINTENTOS_AUTOMATICOS_POR_IMAGEN = 1;

const ESTADOS: readonly EstadoImagenBoleto[] = ["aceptado", "sent", "delivered", "read", "failed"];

/** Orden de avance: un aviso atrasado (un `sent` después de un `delivered`) no hace retroceder. */
const RANGO: Record<EstadoImagenBoleto, number> = {
  aceptado: 0,
  sent: 1,
  failed: 1,
  delivered: 2,
  read: 3,
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function aImagen(v: unknown): ImagenBoleto | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = Number(o.n);
  const de = Number(o.de);
  const storage = texto(o.storage_path).trim();
  if (!Number.isInteger(n) || n < 1 || !storage) return null;
  const estado = ESTADOS.includes(o.estado as EstadoImagenBoleto)
    ? (o.estado as EstadoImagenBoleto)
    : "aceptado";
  return {
    n,
    de: Number.isInteger(de) && de >= n ? de : n,
    numero: texto(o.numero).trim(),
    storage_path: storage,
    pie: texto(o.pie),
    wa_message_id: texto(o.wa_message_id).trim() || null,
    estado,
    envios: Math.max(1, Number(o.envios) || 1),
    error_code: o.error_code == null ? null : texto(o.error_code),
    error: o.error == null ? null : texto(o.error),
    actualizado_at: texto(o.actualizado_at) || undefined,
  };
}

/** Lee la lista desde `payload_snapshot`; vacía si la entrega es anterior a este registro. */
export function leerImagenesDeBoleto(payloadSnapshot: unknown): ImagenBoleto[] {
  if (!payloadSnapshot || typeof payloadSnapshot !== "object") return [];
  const lista = (payloadSnapshot as Record<string, unknown>).imagenes;
  if (!Array.isArray(lista)) return [];
  return lista
    .map(aImagen)
    .filter((x): x is ImagenBoleto => x != null)
    .sort((a, b) => a.n - b.n);
}

/** Llegó al teléfono (o ya la vio): no hace falta volver a mandarla. */
export function imagenConfirmada(img: ImagenBoleto): boolean {
  return img.estado === "delivered" || img.estado === "read";
}

/**
 * Aplica un aviso de Meta a la imagen con ese id de mensaje.
 *
 * `cambio` es false cuando el id no es de esta entrega o el aviso no mueve el estado (llegó
 * repetido o atrasado). Un `failed` sí pisa a `aceptado`/`sent`: es justo el aviso que importa.
 */
export function aplicarEstadoAImagen(
  imagenes: ImagenBoleto[],
  waMessageId: string,
  estado: Exclude<EstadoImagenBoleto, "aceptado">,
  detalle: { errorCode?: string | null; error?: string | null; ahora?: string } = {}
): { imagenes: ImagenBoleto[]; imagen: ImagenBoleto | null; cambio: boolean } {
  const id = waMessageId.trim();
  const i = id ? imagenes.findIndex((img) => img.wa_message_id === id) : -1;
  if (i === -1) return { imagenes, imagen: null, cambio: false };

  const actual = imagenes[i];
  if (actual.estado === estado) return { imagenes, imagen: actual, cambio: false };
  const avanza =
    estado === "failed"
      ? !imagenConfirmada(actual)
      : RANGO[estado] > RANGO[actual.estado] || actual.estado === "failed";
  if (!avanza) return { imagenes, imagen: actual, cambio: false };

  const nueva: ImagenBoleto = {
    ...actual,
    estado,
    error_code: estado === "failed" ? detalle.errorCode ?? null : null,
    error: estado === "failed" ? detalle.error ?? null : null,
    actualizado_at: detalle.ahora ?? new Date().toISOString(),
  };
  const copia = imagenes.slice();
  copia[i] = nueva;
  return { imagenes: copia, imagen: nueva, cambio: true };
}

/** Registra un envío nuevo de la imagen `n` (el primero o un reenvío): id nuevo, estado de cero. */
export function registrarEnvioDeImagen(
  imagenes: ImagenBoleto[],
  img: Omit<ImagenBoleto, "envios" | "estado" | "error_code" | "error">,
  ahora = new Date().toISOString()
): ImagenBoleto[] {
  const previa = imagenes.find((x) => x.n === img.n);
  const nueva: ImagenBoleto = {
    ...img,
    estado: "aceptado",
    envios: (previa?.envios ?? 0) + 1,
    error_code: null,
    error: null,
    actualizado_at: ahora,
  };
  return [...imagenes.filter((x) => x.n !== img.n), nueva].sort((a, b) => a.n - b.n);
}

/**
 * Meta rechazó el envío en el momento (no hay id de mensaje). Queda como fallida sin reintento
 * automático: el reintento en el momento ya se hizo antes de llamar a esto.
 */
export function registrarFalloDeEnvio(
  imagenes: ImagenBoleto[],
  img: Omit<ImagenBoleto, "envios" | "estado" | "error_code" | "error" | "wa_message_id">,
  error: string,
  ahora = new Date().toISOString()
): ImagenBoleto[] {
  const previa = imagenes.find((x) => x.n === img.n);
  const nueva: ImagenBoleto = {
    ...img,
    wa_message_id: null,
    estado: "failed",
    envios: Math.max((previa?.envios ?? 0) + 1, REINTENTOS_AUTOMATICOS_POR_IMAGEN + 1),
    error_code: null,
    error: error.slice(0, 300),
    actualizado_at: ahora,
  };
  return [...imagenes.filter((x) => x.n !== img.n), nueva].sort((a, b) => a.n - b.n);
}

/** ¿Esta imagen fallida todavía tiene un reintento automático? */
export function tocaReintentoAutomatico(img: ImagenBoleto): boolean {
  return img.estado === "failed" && img.envios <= REINTENTOS_AUTOMATICOS_POR_IMAGEN;
}

/**
 * Estado de la fila de entrega según sus imágenes: con alguna fallida queda en `error`, con el
 * motivo, para que aparezca en rojo en Tickets y se pueda reenviar. Una fallida que todavía
 * tiene reintento automático no cuenta: en unos segundos se vuelve a mandar.
 */
export function estadoDeFilaSegunImagenes(
  imagenes: ImagenBoleto[]
): { status: "sent" | "error"; error_message: string | null } {
  const caida = imagenes.find((i) => i.estado === "failed" && !tocaReintentoAutomatico(i));
  return caida
    ? { status: "error", error_message: mensajeDeImagenFallida(caida) }
    : { status: "sent", error_message: null };
}

/**
 * Qué mandar cuando alguien aprieta «Reenviar»: las que no se confirmaron. Si todas llegaron,
 * se mandan todas, porque quien reenvía a mano está pidiendo que el cliente las tenga de nuevo.
 */
export function imagenesParaReenviar(imagenes: ImagenBoleto[]): ImagenBoleto[] {
  const pendientes = imagenes.filter((img) => !imagenConfirmada(img));
  return pendientes.length > 0 ? pendientes : imagenes;
}

export type ResumenImagenes = {
  total: number;
  entregadas: number;
  fallidas: number;
  /** Aceptadas por Meta sin aviso de entrega todavía (teléfono apagado, o aviso en camino). */
  sin_confirmar: number;
  numeros_fallidos: string[];
};

export function resumirImagenes(imagenes: ImagenBoleto[]): ResumenImagenes {
  const fallidas = imagenes.filter((i) => i.estado === "failed");
  const entregadas = imagenes.filter(imagenConfirmada).length;
  return {
    total: imagenes.length,
    entregadas,
    fallidas: fallidas.length,
    sin_confirmar: imagenes.length - entregadas - fallidas.length,
    numeros_fallidos: fallidas.map((i) => i.numero),
  };
}

/** Texto que queda en `error_message` de la entrega cuando una imagen no llegó. */
export function mensajeDeImagenFallida(img: ImagenBoleto): string {
  const motivo = [img.error_code, img.error].filter(Boolean).join(" ").trim();
  const cual = img.de > 1 ? `el boleto ${img.n} de ${img.de}` : "el boleto";
  return `No llegó ${cual} (N.º ${img.numero}) al WhatsApp del cliente${motivo ? `: ${motivo}` : ""}`.slice(
    0,
    500
  );
}

/**
 * Reconstruye la lista para entregas hechas antes de este registro, a partir de los mensajes
 * «Ticket imagen» que quedaron en la conversación («… — Boleto 3 de 3 · N.º 8753»).
 *
 * Las imágenes que no aparecen en ningún mensaje se dan por no enviadas: son justo las que hay
 * que mandar.
 */
export function reconstruirImagenesDesdeMensajes(input: {
  storagePathPrimera: string;
  numeros: string[];
  mensajes: Array<{ content: string | null; wa_message_id: string | null; estado: string | null }>;
  pieBase: string;
}): ImagenBoleto[] {
  const primera = input.storagePathPrimera.trim();
  const numeros = input.numeros.map((n) => n.trim()).filter(Boolean);
  if (!primera) return [];

  /** Una sola imagen, o una compra vieja de antes de mandar una foto por boleto. */
  if (numeros.length <= 1 || !/-1\.png$/.test(primera)) {
    const m = input.mensajes.find((x) => x.wa_message_id);
    return [
      {
        n: 1,
        de: 1,
        numero: numeros.join(", "),
        storage_path: primera,
        pie: input.pieBase,
        wa_message_id: m?.wa_message_id ?? null,
        estado: estadoDesdeMensaje(m?.estado ?? null, Boolean(m)),
        envios: m ? 1 : 0,
      },
    ];
  }

  const de = numeros.length;
  const porN = new Map<number, { numero: string; wa: string | null; estado: string | null }>();
  for (const m of input.mensajes) {
    const hit = /Boleto (\d+) de (\d+) · N\.º (\S+)/.exec(m.content ?? "");
    if (!hit || Number(hit[2]) !== de) continue;
    porN.set(Number(hit[1]), { numero: hit[3], wa: m.wa_message_id, estado: m.estado });
  }

  return numeros.map((numeroPorOrden, i) => {
    const n = i + 1;
    const m = porN.get(n);
    const numero = m?.numero ?? numeroPorOrden;
    return {
      n,
      de,
      numero,
      storage_path: primera.replace(/-1\.png$/, `-${n}.png`),
      pie: `${input.pieBase} — Boleto ${n} de ${de} · N.º ${numero}`.slice(0, 1024),
      wa_message_id: m?.wa ?? null,
      estado: estadoDesdeMensaje(m?.estado ?? null, Boolean(m)),
      envios: m ? 1 : 0,
    };
  });
}

export type BoletoDeEntrega = {
  /** Posición en la compra; es lo que se pide al reenviar uno solo. */
  n: number;
  numero: string;
  /** null: entrega de antes del seguimiento por foto, sin estado conocido en la fila. */
  estado: EstadoImagenBoleto | null;
};

/**
 * Los boletos de una entrega mandados como una foto cada uno, para reenviarlos de a uno.
 *
 * Con el seguimiento por foto sale de `imagenes`. En las entregas de antes se arma con los
 * números en el orden en que se generaron las fotos (`payload_snapshot.cupones`), que es el
 * mismo orden de los archivos `-1.png`, `-2.png`… Vacío si la compra fue una sola imagen.
 */
export function boletosDeEntrega(
  payloadSnapshot: unknown,
  storagePath: string | null | undefined
): BoletoDeEntrega[] {
  const imagenes = leerImagenesDeBoleto(payloadSnapshot);
  if (imagenes.length > 0) {
    return imagenes.length > 1
      ? imagenes.map((i) => ({ n: i.n, numero: i.numero, estado: i.estado }))
      : [];
  }
  if (!/-1\.png$/.test((storagePath ?? "").trim())) return [];
  const snap =
    payloadSnapshot && typeof payloadSnapshot === "object"
      ? (payloadSnapshot as Record<string, unknown>)
      : {};
  const numeros = Array.isArray(snap.cupones)
    ? snap.cupones.map((c) => texto(c).trim()).filter(Boolean)
    : [];
  return numeros.length > 1 ? numeros.map((numero, i) => ({ n: i + 1, numero, estado: null })) : [];
}

/**
 * Archivo de la foto `n` de una entrega. La fila guarda solo la primera (`…/1-1.png`); las
 * demás están al lado, `…/1-2.png`, `…/1-3.png`. null si esa foto no existe en la compra.
 */
export function rutaDeImagenDeBoleto(
  payloadSnapshot: unknown,
  storagePath: string | null | undefined,
  n: number
): string | null {
  const guardada = leerImagenesDeBoleto(payloadSnapshot).find((i) => i.n === n);
  if (guardada) return guardada.storage_path;
  const primera = (storagePath ?? "").trim();
  if (!primera) return null;
  if (n === 1) return primera;
  const boletos = boletosDeEntrega(payloadSnapshot, primera);
  return boletos.some((b) => b.n === n) ? primera.replace(/-1\.png$/, `-${n}.png`) : null;
}

function estadoDesdeMensaje(estado: string | null, huboMensaje: boolean): EstadoImagenBoleto {
  if (!huboMensaje) return "failed";
  const e = (estado ?? "").trim().toLowerCase();
  return e === "sent" || e === "delivered" || e === "read" || e === "failed" ? e : "aceptado";
}
