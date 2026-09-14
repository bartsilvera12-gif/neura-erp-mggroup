import "server-only";

import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { persistOutgoingChatMessage } from "@/lib/chat/outgoing-message-persist";
import { resolveOutboundTextContextFromIds } from "@/lib/chat/outbound-send-dispatch";
import {
  sendWhatsAppImage,
  sendWhatsAppImageById,
  uploadWhatsAppMedia,
} from "@/lib/chat/whatsapp-send-service";
import { sendYCloudWhatsappMediaViaLink } from "@/lib/chat/ycloud-send-service";
import { createSignedUrlForTicket } from "@/lib/sorteos/sorteo-ticket-storage";
import { normalizeTicketImageConfig } from "@/lib/sorteos/sorteo-ticket-types";
import {
  aplicarEstadoAImagen,
  estadoDeFilaSegunImagenes,
  imagenesParaReenviar,
  leerImagenesDeBoleto,
  reconstruirImagenesDesdeMensajes,
  registrarEnvioDeImagen,
  registrarFalloDeEnvio,
  tocaReintentoAutomatico,
  type EstadoImagenBoleto,
  type ImagenBoleto,
} from "@/lib/sorteos/sorteo-ticket-imagenes";

/**
 * Espera entre una foto y la siguiente al mismo cliente.
 *
 * Meta limita cuántos mensajes seguidos se le pueden mandar a un mismo número (error 131056,
 * «pair rate limit»). Tres fotos disparadas una detrás de otra, justo después del mensaje de
 * cierre del flujo, es exactamente esa ráfaga. El envío corre después de responderle a Meta,
 * así que la espera no demora al webhook.
 */
export const PAUSA_ENTRE_IMAGENES_MS = 1500;

/** Antes de reintentar una foto que falló, para no chocar otra vez contra el mismo límite. */
const PAUSA_ANTES_DE_REINTENTAR_MS = 4000;

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Outbound = Awaited<ReturnType<typeof resolveOutboundTextContextFromIds>>;

export type ResultadoEnvioImagen = {
  ok: boolean;
  waMessageId: string | null;
  raw?: unknown;
  error?: string;
};

/** Baja la imagen desde el Storage para subirla a Meta. */
async function bajarImagen(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Manda una imagen por el proveedor del canal. Devuelve ok solo si el proveedor dio un id.
 *
 * Con Meta la imagen se sube primero y se manda por id. Mandarla por link deja que Meta la
 * descargue por su cuenta después de aceptar el mensaje: si esa descarga falla, el mensaje
 * vuelve `failed` con 131053 («Media upload error») y el boleto no llega. Eso le pasó al
 * boleto 3 de la orden 313. Si la subida falla, se prueba con el link como antes.
 */
export async function enviarImagenPorWhatsapp(
  outbound: Outbound,
  imageUrl: string,
  caption: string,
  bytes?: Uint8Array | null
): Promise<ResultadoEnvioImagen> {
  if (outbound.provider !== "ycloud") {
    const archivo = bytes ?? (await bajarImagen(imageUrl));
    if (archivo && archivo.length > 0) {
      const up = await uploadWhatsAppMedia({
        phoneNumberId: outbound.phoneNumberId,
        accessToken: outbound.accessToken,
        bytes: archivo,
        mime: "image/png",
        filename: "boleto.png",
      });
      if (up.ok) {
        const r = await sendWhatsAppImageById({
          toDigits: outbound.toDigits,
          phoneNumberId: outbound.phoneNumberId,
          accessToken: outbound.accessToken,
          mediaId: up.mediaId,
          caption,
        });
        if (!r.ok) return { ok: false, waMessageId: null, raw: r.raw, error: r.error || "send_failed" };
        const id = typeof r.waMessageId === "string" && r.waMessageId.trim() ? r.waMessageId.trim() : null;
        return { ok: true, waMessageId: id, raw: r.raw };
      }
      console.warn("[sorteo-ticket] subida_a_meta_fallo_se_usa_link", { error: up.error, status: up.status ?? null });
    } else {
      console.warn("[sorteo-ticket] no_se_pudo_bajar_imagen_se_usa_link");
    }
  }

  const r =
    outbound.provider === "ycloud"
      ? await sendYCloudWhatsappMediaViaLink({
          apiKey: outbound.apiKey,
          fromE164: outbound.fromE164,
          toDigits: outbound.toDigits,
          kind: "image",
          mediaLink: imageUrl,
          caption,
        })
      : await sendWhatsAppImage({
          toDigits: outbound.toDigits,
          phoneNumberId: outbound.phoneNumberId,
          accessToken: outbound.accessToken,
          imageUrl,
          caption,
        });
  if (!r.ok) return { ok: false, waMessageId: null, raw: r.raw, error: r.error || "send_failed" };
  const waMessageId =
    typeof r.waMessageId === "string" && r.waMessageId.trim() ? r.waMessageId.trim() : null;
  return { ok: true, waMessageId, raw: r.raw };
}

type FilaEntrega = {
  id: string;
  status: string;
  payload_snapshot: Record<string, unknown>;
};

/**
 * Cambia la lista de imágenes de una entrega sin pisar un cambio que entró en paralelo.
 *
 * Los avisos de Meta de las tres fotos llegan casi juntos, cada uno en su propio webhook, y a
 * la vez el envío puede estar registrando la foto siguiente. Leer, cambiar y escribir sin
 * bloqueo haría que el último en escribir borre lo que anotó el otro. Con la base directa se
 * bloquea la fila mientras dura el cambio.
 *
 * `fn` recibe la lista y la fila, y devuelve la lista nueva (o null para no tocar nada). Si la
 * fila está en `sent`/`error`, su estado se recalcula con las imágenes; en `pending`/`generated`
 * todavía se está mandando y el estado final lo pone quien manda.
 */
export async function actualizarImagenesDeEntrega(
  supabase: AppSupabaseClient,
  empresaId: string,
  deliveryId: string,
  fn: (imagenes: ImagenBoleto[], fila: FilaEntrega) => ImagenBoleto[] | null,
  opciones: { forzarEstadoFinal?: boolean } = {}
): Promise<{ imagenes: ImagenBoleto[]; antes: ImagenBoleto[]; status: string } | null> {
  const calcular = (fila: FilaEntrega) => {
    const antes = leerImagenesDeBoleto(fila.payload_snapshot);
    const nuevas = fn(antes, fila);
    if (!nuevas) return null;
    const recalcula =
      opciones.forzarEstadoFinal || fila.status === "sent" || fila.status === "error";
    const est = recalcula ? estadoDeFilaSegunImagenes(nuevas) : null;
    return { antes, nuevas, est };
  };

  const pool = getChatPostgresPool();
  let tabla: string | null = null;
  if (pool) {
    try {
      tabla = quoteSchemaTable(await fetchDataSchemaForEmpresaId(empresaId), "sorteo_ticket_deliveries");
    } catch {
      tabla = null;
    }
  }

  if (pool && tabla) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT id::text, status, COALESCE(payload_snapshot, '{}'::jsonb) AS payload_snapshot
           FROM ${tabla}
          WHERE id = $1::uuid AND empresa_id = $2::uuid
          FOR UPDATE`,
        [deliveryId, empresaId]
      );
      const fila = r.rows[0] as FilaEntrega | undefined;
      const c = fila ? calcular(fila) : null;
      if (!fila || !c) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE ${tabla}
            SET payload_snapshot = jsonb_set(COALESCE(payload_snapshot, '{}'::jsonb), '{imagenes}', $2::jsonb),
                status = COALESCE($3, status),
                error_message = CASE WHEN $3::text IS NULL THEN error_message ELSE $4 END,
                updated_at = now()
          WHERE id = $1::uuid`,
        [deliveryId, JSON.stringify(c.nuevas), c.est?.status ?? null, c.est?.error_message ?? null]
      );
      await client.query("COMMIT");
      return { imagenes: c.nuevas, antes: c.antes, status: c.est?.status ?? fila.status };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Sin base directa: leer y escribir. Puede perder un aviso si llegan dos juntos. */
  const { data } = await supabase
    .from("sorteo_ticket_deliveries")
    .select("id, status, payload_snapshot")
    .eq("id", deliveryId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const fila = data as FilaEntrega | null;
  if (!fila) return null;
  fila.payload_snapshot = (fila.payload_snapshot ?? {}) as Record<string, unknown>;
  const c = calcular(fila);
  if (!c) return null;
  const patch: Record<string, unknown> = {
    payload_snapshot: { ...fila.payload_snapshot, imagenes: c.nuevas },
    updated_at: new Date().toISOString(),
  };
  if (c.est) {
    patch.status = c.est.status;
    patch.error_message = c.est.error_message;
  }
  await supabase.from("sorteo_ticket_deliveries").update(patch).eq("id", deliveryId);
  return { imagenes: c.nuevas, antes: c.antes, status: c.est?.status ?? fila.status };
}

/**
 * Manda una imagen ya generada y deja anotado el resultado en la entrega y en el chat.
 * Si Meta la rechaza en el momento, espera y prueba una vez más antes de darla por fallida.
 */
export async function mandarYRegistrarImagen(input: {
  supabase: AppSupabaseClient;
  empresaId: string;
  deliveryId: string;
  conversationId: string | null;
  outbound: Outbound;
  imagen: Pick<ImagenBoleto, "n" | "de" | "numero" | "storage_path" | "pie">;
  automationSource: string;
  prefijoChat: string;
  /** El PNG recién generado, si se tiene a mano: se ahorra bajarlo del Storage. */
  bytes?: Uint8Array | null;
}): Promise<ResultadoEnvioImagen> {
  const { supabase, imagen } = input;
  const signed = await createSignedUrlForTicket(supabase, imagen.storage_path, 600);

  let r: ResultadoEnvioImagen = { ok: false, waMessageId: null, error: signed.error ?? "signed_url" };
  if (signed.url) {
    r = await enviarImagenPorWhatsapp(input.outbound, signed.url, imagen.pie, input.bytes);
    if (!r.ok) {
      console.warn("[sorteo-ticket] imagen_rechazada_reintento", {
        deliveryId: input.deliveryId,
        imagen: imagen.n,
        de: imagen.de,
        error: r.error,
      });
      await esperar(PAUSA_ANTES_DE_REINTENTAR_MS);
      r = await enviarImagenPorWhatsapp(input.outbound, signed.url, imagen.pie, input.bytes);
    }
  }

  /** Solo cuenta como mandada si hay id de mensaje: sin id no hay forma de seguirla. */
  const aceptada = r.ok && Boolean(r.waMessageId);
  await actualizarImagenesDeEntrega(supabase, input.empresaId, input.deliveryId, (imgs) =>
    aceptada
      ? registrarEnvioDeImagen(imgs, { ...imagen, wa_message_id: r.waMessageId })
      : registrarFalloDeEnvio(imgs, imagen, r.error ?? (r.ok ? "sin_id_de_mensaje" : "send_failed"))
  );

  console[aceptada ? "info" : "warn"]("[sorteo-ticket] imagen_enviada", {
    deliveryId: input.deliveryId,
    imagen: imagen.n,
    de: imagen.de,
    numero: imagen.numero,
    aceptada,
    whatsapp_message_id: r.waMessageId,
    error: aceptada ? null : r.error ?? null,
  });

  if (aceptada && input.conversationId?.trim()) {
    await persistOutgoingChatMessage(supabase, {
      conversation: { id: input.conversationId.trim(), empresa_id: input.empresaId },
      content: `${input.prefijoChat}\n${imagen.pie}`,
      messageType: "image",
      waMessageId: r.waMessageId,
      raw: r.raw ?? {},
      senderType: "system",
      automationSource: input.automationSource,
    });
  }

  return aceptada ? r : { ...r, ok: false };
}

type FilaParaReenvio = {
  id: string;
  entrada_id: string;
  sorteo_id: string;
  conversation_id: string | null;
  channel_id: string | null;
  storage_path: string | null;
  numero_orden: string | null;
  cupones: unknown;
  payload_snapshot: unknown;
  config_snapshot: unknown;
  created_at: string;
};

function pieBaseDeFila(fila: FilaParaReenvio, sorteoNombre: string): string {
  const cfg = normalizeTicketImageConfig(fila.config_snapshot);
  return (
    (cfg.caption ?? "").trim() ||
    (cfg.title ?? "").trim() ||
    `Orden Nº ${fila.numero_orden ?? ""} — ${sorteoNombre}`
  ).slice(0, 1024);
}

function numerosDeFila(fila: FilaParaReenvio): string[] {
  const snap = (fila.payload_snapshot ?? {}) as Record<string, unknown>;
  if (Array.isArray(snap.cupones)) return snap.cupones.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (Array.isArray(fila.cupones)) {
    return fila.cupones
      .map((c) => String((c as { numero_cupon?: unknown })?.numero_cupon ?? "").trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Imágenes de una entrega. Las entregas de antes de este registro no tienen la lista: se arma
 * con los mensajes «Ticket imagen» de la conversación y el estado que dejó Meta en cada uno.
 */
async function imagenesDeFila(
  supabase: AppSupabaseClient,
  fila: FilaParaReenvio,
  sorteoNombre: string
): Promise<ImagenBoleto[]> {
  const guardadas = leerImagenesDeBoleto(fila.payload_snapshot);
  if (guardadas.length > 0) return guardadas;
  if (!fila.storage_path?.trim()) return [];

  let mensajes: Array<{ content: string | null; wa_message_id: string | null; estado: string | null }> = [];
  if (fila.conversation_id) {
    const hasta = new Date(Date.parse(fila.created_at) + 30 * 60_000).toISOString();
    const { data } = await supabase
      .from("chat_messages")
      .select("content, wa_message_id, whatsapp_delivery_status")
      .eq("conversation_id", fila.conversation_id)
      .eq("automation_source", "sorteo_ticket")
      .gte("created_at", fila.created_at)
      .lte("created_at", hasta)
      .order("created_at", { ascending: true })
      .limit(50);
    mensajes = ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
      content: typeof m.content === "string" ? m.content : null,
      wa_message_id: typeof m.wa_message_id === "string" ? m.wa_message_id : null,
      estado: typeof m.whatsapp_delivery_status === "string" ? m.whatsapp_delivery_status : null,
    }));
  }

  return reconstruirImagenesDesdeMensajes({
    storagePathPrimera: fila.storage_path,
    numeros: numerosDeFila(fila),
    mensajes,
    pieBase: pieBaseDeFila(fila, sorteoNombre),
  });
}

export type ResultadoReenvio = {
  ok: boolean;
  error?: string;
  enviadas?: number;
  fallidas?: number;
  numeros?: string[];
};

/**
 * Vuelve a mandar imágenes de una entrega: las que no llegaron, o las indicadas por número de
 * boleto. No genera nada nuevo ni toca la venta.
 */
export async function reenviarImagenesDeEntrega(input: {
  supabase: AppSupabaseClient;
  empresaId: string;
  deliveryId: string;
  /** Solo estas posiciones (1 = primer boleto). Sin esto, las que no se confirmaron. */
  soloN?: number[];
  channelIdFallback?: string | null;
  automationSource: "sorteo_ticket_resend" | "sorteo_ticket_reintento";
}): Promise<ResultadoReenvio> {
  const schema = await fetchDataSchemaForEmpresaId(input.empresaId);
  const db = input.supabase;

  const { data: row, error: r0 } = await db
    .from("sorteo_ticket_deliveries")
    .select(
      "id, entrada_id, sorteo_id, conversation_id, channel_id, storage_path, numero_orden, cupones, payload_snapshot, config_snapshot, created_at"
    )
    .eq("id", input.deliveryId)
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  if (r0 || !row) return { ok: false, error: "not_found" };
  const fila = row as FilaParaReenvio;

  const convId = fila.conversation_id;
  if (!convId) return { ok: false, error: "no_conversation" };

  const { data: conv } = await db
    .from("chat_conversations")
    .select("contact_id, channel_id")
    .eq("id", convId)
    .maybeSingle();
  const contactId = (conv as { contact_id?: string } | null)?.contact_id;
  const channelId =
    fila.channel_id ||
    input.channelIdFallback ||
    (conv as { channel_id?: string | null } | null)?.channel_id ||
    null;
  if (!contactId || !channelId) return { ok: false, error: "no_conversation" };

  const { data: sorteo } = await db
    .from("sorteos")
    .select("nombre")
    .eq("id", fila.sorteo_id)
    .maybeSingle();
  const sorteoNombre = String((sorteo as { nombre?: string } | null)?.nombre ?? "").trim();

  const todas = await imagenesDeFila(db, fila, sorteoNombre);
  if (todas.length === 0) return { ok: false, error: "no_file" };

  /** Una entrega vieja se guarda con su lista armada, así los avisos de Meta tienen dónde caer. */
  if (leerImagenesDeBoleto(fila.payload_snapshot).length === 0) {
    await actualizarImagenesDeEntrega(db, input.empresaId, fila.id, () => todas);
  }

  const elegidas = input.soloN?.length
    ? todas.filter((i) => input.soloN!.includes(i.n))
    : imagenesParaReenviar(todas);
  if (elegidas.length === 0) return { ok: false, error: "sin_imagenes" };

  let outbound: Outbound;
  try {
    outbound = await resolveOutboundTextContextFromIds(
      db,
      { contactId, channelId },
      { dataSchema: schema, empresaId: input.empresaId }
    );
  } catch {
    return { ok: false, error: "outbound" };
  }

  const prefijo =
    input.automationSource === "sorteo_ticket_reintento"
      ? "Ticket imagen (reintento automático)"
      : "Ticket imagen (reenvío)";

  let enviadas = 0;
  let fallidas = 0;
  for (const [i, img] of elegidas.entries()) {
    if (i > 0) await esperar(PAUSA_ENTRE_IMAGENES_MS);
    const r = await mandarYRegistrarImagen({
      supabase: db,
      empresaId: input.empresaId,
      deliveryId: fila.id,
      conversationId: convId,
      outbound,
      imagen: img,
      automationSource: input.automationSource,
      prefijoChat: prefijo,
    });
    if (r.ok) enviadas++;
    else fallidas++;
  }

  /** Estado de la fila con lo que quedó, y la fecha del último envío. */
  await actualizarImagenesDeEntrega(db, input.empresaId, fila.id, (imgs) => imgs, {
    forzarEstadoFinal: true,
  });
  await db
    .from("sorteo_ticket_deliveries")
    .update({ provider: outbound.provider, channel_id: channelId, sent_at: new Date().toISOString() })
    .eq("id", fila.id);

  return {
    ok: enviadas > 0 && fallidas === 0,
    error: fallidas > 0 ? "send_failed" : undefined,
    enviadas,
    fallidas,
    numeros: elegidas.map((i) => i.numero),
  };
}

/**
 * Aviso de Meta sobre una imagen de boleto: se anota en la imagen, y si falló, se vuelve a
 * mandar sola una vez. Si vuelve a fallar, la entrega queda en error con el número que no
 * llegó, para reenviarla desde Tickets.
 *
 * La llama el webhook de estados solo para mensajes de boletos, así que no le suma consultas
 * al resto de los mensajes.
 */
export async function registrarEstadoDeImagenDeBoleto(input: {
  empresaId: string;
  conversationId: string;
  channelId: string;
  waMessageId: string;
  estado: Exclude<EstadoImagenBoleto, "aceptado">;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const supabase = await getChatServiceClientForEmpresa(input.empresaId);

  /** La entrega es de esta conversación y reciente: basta mirar las últimas. */
  const { data } = await supabase
    .from("sorteo_ticket_deliveries")
    .select("id, payload_snapshot")
    .eq("empresa_id", input.empresaId)
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  const fila = ((data ?? []) as Array<{ id: string; payload_snapshot: unknown }>).find((f) =>
    leerImagenesDeBoleto(f.payload_snapshot).some((i) => i.wa_message_id === input.waMessageId)
  );
  if (!fila) return;

  const hecho = await actualizarImagenesDeEntrega(supabase, input.empresaId, fila.id, (imgs) => {
    const r = aplicarEstadoAImagen(imgs, input.waMessageId, input.estado, {
      errorCode: input.errorCode,
      error: input.errorMessage,
    });
    return r.cambio ? r.imagenes : null;
  });
  if (!hecho) return;

  const imagen = hecho.imagenes.find((i) => i.wa_message_id === input.waMessageId);
  console.info("[sorteo-ticket] imagen_estado", {
    deliveryId: fila.id,
    imagen: imagen?.n ?? null,
    de: imagen?.de ?? null,
    numero: imagen?.numero ?? null,
    estado: input.estado,
    error_code: input.errorCode ?? null,
    error: input.errorMessage ?? null,
  });

  if (!imagen || !tocaReintentoAutomatico(imagen)) return;

  await esperar(PAUSA_ANTES_DE_REINTENTAR_MS);
  const r = await reenviarImagenesDeEntrega({
    supabase,
    empresaId: input.empresaId,
    deliveryId: fila.id,
    soloN: [imagen.n],
    channelIdFallback: input.channelId,
    automationSource: "sorteo_ticket_reintento",
  });
  console[r.ok ? "info" : "warn"]("[sorteo-ticket] imagen_reintento_automatico", {
    deliveryId: fila.id,
    imagen: imagen.n,
    numero: imagen.numero,
    ok: r.ok,
    error: r.error ?? null,
  });
}
