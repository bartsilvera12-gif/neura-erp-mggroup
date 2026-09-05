import "server-only";

import type { SupabaseAdmin } from "@/lib/chat/types";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { verificarPin } from "@/lib/sorteos/vendedor-pin";
import { createSorteoManualCashSaleViaDirectPostgres } from "@/lib/sorteos/sorteo-order-manual-pg";
import {
  resolveOutboundTextContextFromConversationId,
  sendOutboundTextMessage,
} from "@/lib/chat/outbound-send-dispatch";
import {
  buildOrderResultFromEntradaId,
  flowDataStubFromEntrada,
} from "@/lib/sorteos/sorteo-ticket-admin";
import { maybeGenerateAndSendSorteoTicketDelivery } from "@/lib/sorteos/sorteo-ticket-delivery";

/**
 * Modo venta del vendedor por WhatsApp.
 *
 * El vendedor escribe `#VENTA` al número corporativo —el mismo al que escriben los clientes—,
 * se identifica con su número de vendedor y su PIN, y carga la venta paso a paso. La venta
 * queda atribuida a él, así que aparece en su cierre de caja y en el ranking.
 *
 * Mientras dura el modo venta, sus mensajes NO entran al flujo del comprador: si no, el bot le
 * contestaría el menú del sorteo en medio de la carga.
 */

const LOG = "[venta-vendedor]";

/** Inactividad tras la cual la sesión se descarta. El PIN viaja por el chat: no queda abierta. */
const MINUTOS_VIGENCIA = 15;
const MAX_INTENTOS_PIN = 3;
/** Tope por venta, igual que el flujo del comprador. */
const MAX_BOLETAS = 20;

type Paso = "id" | "pin" | "telefono" | "nombre" | "cedula" | "cantidad";

type Sesion = {
  conversation_id: string;
  empresa_id: string;
  revendedor_id: string | null;
  paso: Paso;
  datos: Record<string, string>;
  intentos_pin: number;
};

export type ResultadoModoVenta = { manejado: boolean };

/**
 * El comando exige el numeral. «venta» a secas queda afuera a propósito: es una palabra que un
 * comprador escribe con total naturalidad («quiero una venta», «venta?»), y con ella el bot le
 * respondería «ingresá tu número de vendedor» en vez de venderle. El numeral es justamente lo
 * que la vuelve un comando y no una palabra suelta.
 */
function esComandoVenta(texto: string): boolean {
  const t = texto.trim().toLowerCase().replace(/\s+/g, " ");
  return t === "#venta" || t === "# venta" || t === "#ventas" || t === "numeral venta";
}

function esComandoSalir(texto: string): boolean {
  const t = texto.trim().toLowerCase();
  return t === "#salir" || t === "salir" || t === "cancelar" || t === "#cancelar";
}

function soloDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

function entorno(): { pool: NonNullable<ReturnType<typeof getChatPostgresPool>>; schema: string } | null {
  const pool = getChatPostgresPool();
  const schema = getSingleClientSchemaOrNull();
  return pool && schema ? { pool, schema } : null;
}

async function enviar(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  texto: string
): Promise<void> {
  try {
    const ctx = await resolveOutboundTextContextFromConversationId(supabase, conversationId, empresaId);
    const r = await sendOutboundTextMessage(ctx, texto);
    if (r.ok) {
      await supabase.from("chat_messages").insert({
        empresa_id: empresaId,
        conversation_id: conversationId,
        wa_message_id: r.waMessageId,
        from_me: true,
        sender_type: "system",
        message_type: "text",
        content: texto,
        raw_payload: (r.raw ?? {}) as Record<string, unknown>,
      });
    }
  } catch (e) {
    console.error(LOG, "envio_fallido", e instanceof Error ? e.message : e);
  }
}

async function leerSesion(
  conversationId: string
): Promise<Sesion | null> {
  const e = entorno();
  if (!e) return null;
  const t = quoteSchemaTable(e.schema, "sorteo_venta_vendedor_sesiones");
  try {
    const r = await e.pool.query(
      `SELECT conversation_id::text, empresa_id::text, revendedor_id::text, paso, datos, intentos_pin
         FROM ${t} WHERE conversation_id = $1::uuid AND expira_at > now() LIMIT 1`,
      [conversationId]
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      conversation_id: String(row.conversation_id),
      empresa_id: String(row.empresa_id),
      revendedor_id: row.revendedor_id == null ? null : String(row.revendedor_id),
      paso: String(row.paso) as Paso,
      datos: (row.datos as Record<string, string>) ?? {},
      intentos_pin: Number(row.intentos_pin ?? 0),
    };
  } catch (err) {
    /** Sin migrar todavía: el modo venta simplemente no existe y el flujo normal sigue igual. */
    console.warn(LOG, "sesiones_no_disponible", err instanceof Error ? err.message : err);
    return null;
  }
}

async function guardarSesion(s: Sesion): Promise<void> {
  const e = entorno();
  if (!e) return;
  const t = quoteSchemaTable(e.schema, "sorteo_venta_vendedor_sesiones");
  await e.pool.query(
    `INSERT INTO ${t}
       (conversation_id, empresa_id, revendedor_id, paso, datos, intentos_pin, expira_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6, $7::timestamptz, now())
     ON CONFLICT (conversation_id) DO UPDATE SET
       revendedor_id = EXCLUDED.revendedor_id,
       paso = EXCLUDED.paso,
       datos = EXCLUDED.datos,
       intentos_pin = EXCLUDED.intentos_pin,
       expira_at = EXCLUDED.expira_at,
       updated_at = now()`,
    [
      s.conversation_id,
      s.empresa_id,
      s.revendedor_id,
      s.paso,
      JSON.stringify(s.datos),
      s.intentos_pin,
      /**
       * El vencimiento se calcula acá y viaja como fecha. Antes se armaba en SQL con
       * `($n || ' minutes')::interval` y Postgres no podía inferir el tipo del parámetro: la
       * consulta fallaba, el webhook atrapaba el error y el `#VENTA` terminaba contestado por
       * el flujo del comprador, como si el comando no existiera.
       */
      new Date(Date.now() + MINUTOS_VIGENCIA * 60_000).toISOString(),
    ]
  );
}

async function borrarSesion(conversationId: string): Promise<void> {
  const e = entorno();
  if (!e) return;
  const t = quoteSchemaTable(e.schema, "sorteo_venta_vendedor_sesiones");
  await e.pool.query(`DELETE FROM ${t} WHERE conversation_id = $1::uuid`, [conversationId]);
}

type Vendedor = {
  id: string;
  nombre: string;
  numero: number;
  pin_hash: string | null;
  cupo: number | null;
};

async function buscarVendedorPorNumero(
  empresaId: string,
  numero: number
): Promise<Vendedor | null> {
  const e = entorno();
  if (!e) return null;
  const t = quoteSchemaTable(e.schema, "sorteo_revendedores");
  const r = await e.pool.query(
    `SELECT id::text, nombre, numero_vendedor, pin_hash, cupo_boletos
       FROM ${t}
      WHERE empresa_id = $1::uuid AND numero_vendedor = $2 AND COALESCE(activo, true) = true
      LIMIT 1`,
    [empresaId, numero]
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? "").trim(),
    numero: Number(row.numero_vendedor),
    pin_hash: row.pin_hash == null ? null : String(row.pin_hash),
    cupo: row.cupo_boletos == null ? null : Number(row.cupo_boletos),
  };
}

async function sorteoActivo(
  empresaId: string
): Promise<{ id: string; nombre: string; precio: number } | null> {
  const e = entorno();
  if (!e) return null;
  const t = quoteSchemaTable(e.schema, "sorteos");
  const r = await e.pool.query(
    `SELECT id::text, nombre, precio_por_boleto
       FROM ${t}
      WHERE empresa_id = $1::uuid AND estado = 'activo'
      ORDER BY created_at DESC LIMIT 1`,
    [empresaId]
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? "").trim(),
    precio: Number(row.precio_por_boleto ?? 0) || 0,
  };
}

const PYG = new Intl.NumberFormat("es-PY");
const gs = (n: number) => "Gs. " + PYG.format(Math.round(n || 0));

/**
 * Procesa un mensaje de texto en clave "modo venta".
 *
 * Devuelve `manejado: true` cuando el mensaje pertenece al modo venta; en ese caso el webhook
 * NO debe pasarlo al flujo del comprador.
 */
export async function procesarModoVentaVendedor(input: {
  supabase: SupabaseAdmin;
  empresaId: string;
  conversationId: string;
  texto: string;
  contactId: string | null;
  channelId: string | null;
}): Promise<ResultadoModoVenta> {
  const { supabase, empresaId, conversationId, texto } = input;
  const t = (texto ?? "").trim();
  if (!t) return { manejado: false };

  const sesion = await leerSesion(conversationId);

  if (!sesion) {
    if (!esComandoVenta(t)) return { manejado: false };
    try {
      await guardarSesion({
        conversation_id: conversationId,
        empresa_id: empresaId,
        revendedor_id: null,
        paso: "id",
        datos: {},
        intentos_pin: 0,
      });
    } catch (err) {
      /**
       * Sin la tabla de sesiones el modo venta no puede arrancar. Antes el mensaje seguía de
       * largo al flujo del comprador y el vendedor recibía el menú del sorteo: parecía que
       * `#VENTA` no existiera. Es mejor decirlo, y que quede claro en el log qué falta.
       */
      console.error(
        LOG,
        "modo_venta_no_disponible",
        "¿Falta correr la migración sorteo_venta_vendedor_sesiones?",
        err instanceof Error ? err.message : err
      );
      await enviar(
        supabase,
        empresaId,
        conversationId,
        "El modo venta todavía no está disponible. Avisale al administrador."
      );
      return { manejado: true };
    }
    await enviar(
      supabase,
      empresaId,
      conversationId,
      "🧑‍💼 *Modo venta activado*\n\nIngresá tu *número de vendedor*:\n\n_Escribí *salir* para cancelar._"
    );
    return { manejado: true };
  }

  if (esComandoSalir(t)) {
    await borrarSesion(conversationId);
    await enviar(supabase, empresaId, conversationId, "Modo venta cancelado. 👋");
    return { manejado: true };
  }

  /** Volver a escribir #VENTA reinicia: sirve si se equivocó y quedó a mitad de camino. */
  if (esComandoVenta(t)) {
    await borrarSesion(conversationId);
    return procesarModoVentaVendedor(input);
  }

  switch (sesion.paso) {
    case "id": {
      const n = Number(soloDigitos(t));
      if (!Number.isFinite(n) || n <= 0) {
        await enviar(supabase, empresaId, conversationId, "Ingresá tu número de vendedor (solo números).");
        return { manejado: true };
      }
      const v = await buscarVendedorPorNumero(empresaId, n);
      if (!v) {
        await enviar(
          supabase,
          empresaId,
          conversationId,
          "No encontramos un vendedor activo con ese número. Probá de nuevo o escribí *salir*."
        );
        return { manejado: true };
      }
      if (!v.pin_hash) {
        await borrarSesion(conversationId);
        await enviar(
          supabase,
          empresaId,
          conversationId,
          `${v.nombre}, todavía no tenés PIN configurado. Pedile al administrador que te genere uno.`
        );
        return { manejado: true };
      }
      await guardarSesion({
        ...sesion,
        revendedor_id: v.id,
        paso: "pin",
        datos: { ...sesion.datos, vendedor_nombre: v.nombre, vendedor_numero: String(v.numero) },
      });
      await enviar(
        supabase,
        empresaId,
        conversationId,
        `🔐 Hola *${v.nombre}*.\n\nIngresá tu *PIN* para confirmar tu identidad:`
      );
      return { manejado: true };
    }

    case "pin": {
      const e = entorno();
      if (!e || !sesion.revendedor_id) return { manejado: false };
      const tRev = quoteSchemaTable(e.schema, "sorteo_revendedores");
      const r = await e.pool.query<{ pin_hash: string | null }>(
        `SELECT pin_hash FROM ${tRev} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
        [sesion.revendedor_id, empresaId]
      );
      if (!verificarPin(t, r.rows[0]?.pin_hash)) {
        const intentos = sesion.intentos_pin + 1;
        if (intentos >= MAX_INTENTOS_PIN) {
          await borrarSesion(conversationId);
          await enviar(
            supabase,
            empresaId,
            conversationId,
            "PIN incorrecto demasiadas veces. Modo venta cancelado por seguridad."
          );
          return { manejado: true };
        }
        await guardarSesion({ ...sesion, intentos_pin: intentos });
        await enviar(
          supabase,
          empresaId,
          conversationId,
          `PIN incorrecto. Te queda${MAX_INTENTOS_PIN - intentos === 1 ? "" : "n"} ${MAX_INTENTOS_PIN - intentos} intento(s).`
        );
        return { manejado: true };
      }
      await guardarSesion({ ...sesion, paso: "telefono", intentos_pin: 0 });
      await enviar(
        supabase,
        empresaId,
        conversationId,
        "✅ *Identidad confirmada*\n\n📱 Ingresá el *teléfono* del cliente:"
      );
      return { manejado: true };
    }

    case "telefono": {
      const tel = soloDigitos(t);
      if (tel.length < 6) {
        await enviar(supabase, empresaId, conversationId, "Ingresá un teléfono válido (solo números).");
        return { manejado: true };
      }
      await guardarSesion({ ...sesion, paso: "nombre", datos: { ...sesion.datos, telefono: t.trim() } });
      await enviar(supabase, empresaId, conversationId, "📝 Ingresá el *nombre y apellido* del cliente:");
      return { manejado: true };
    }

    case "nombre": {
      if (t.length < 2) {
        await enviar(supabase, empresaId, conversationId, "Ingresá el nombre del cliente.");
        return { manejado: true };
      }
      await guardarSesion({ ...sesion, paso: "cedula", datos: { ...sesion.datos, nombre: t } });
      await enviar(supabase, empresaId, conversationId, "🪪 Ingresá la *cédula* del cliente:");
      return { manejado: true };
    }

    case "cedula": {
      /** Sin validar formato: hay cédulas con guiones y letras. */
      await guardarSesion({ ...sesion, paso: "cantidad", datos: { ...sesion.datos, cedula: t } });
      await enviar(
        supabase,
        empresaId,
        conversationId,
        `🎟 ¿Cuántas boletas? _(máximo ${MAX_BOLETAS})_`
      );
      return { manejado: true };
    }

    case "cantidad": {
      const cant = Number(soloDigitos(t));
      if (!Number.isFinite(cant) || cant < 1) {
        await enviar(supabase, empresaId, conversationId, "Respondé solo el número. Ej: 2");
        return { manejado: true };
      }
      if (cant > MAX_BOLETAS) {
        await enviar(supabase, empresaId, conversationId, `El máximo por venta es ${MAX_BOLETAS} boletas.`);
        return { manejado: true };
      }

      const e = entorno();
      const sorteo = await sorteoActivo(empresaId);
      if (!e || !sorteo || !sesion.revendedor_id) {
        await borrarSesion(conversationId);
        await enviar(supabase, empresaId, conversationId, "No hay un sorteo activo para registrar la venta.");
        return { manejado: true };
      }

      const monto = cant * sorteo.precio;
      const creada = await createSorteoManualCashSaleViaDirectPostgres({
        schema: e.schema,
        empresaId,
        sorteoId: sorteo.id,
        /** Determinístico por conversación y paso: un reintento de Meta no duplica la venta. */
        idempotencyKey: `wa-vendedor-${conversationId}-${Date.now()}`,
        nombre: sesion.datos.nombre ?? "",
        apellido: "",
        cedula: sesion.datos.cedula ?? "",
        telefono: sesion.datos.telefono ?? "",
        cantidadBoletos: cant,
        montoTotal: monto,
        revendedorId: sesion.revendedor_id,
        pagoMetodo: "efectivo",
        validadoPor: "vendedor_whatsapp",
      });

      await borrarSesion(conversationId);

      if (!creada.ok) {
        await enviar(supabase, empresaId, conversationId, `No se pudo registrar la venta: ${creada.message}`);
        return { manejado: true };
      }

      const cupones = (creada.cupones ?? []).map((c) => c.numero_cupon).join("  ");
      const base = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ?? "";
      const linkTicket = base ? `\n\n🖨 Imprimir: ${base}/ticket/${creada.entradaId}` : "";

      await enviar(
        supabase,
        empresaId,
        conversationId,
        `✅ *Venta registrada*\n\n` +
          `*Orden:* #${creada.numeroOrden}\n` +
          `*Cliente:* ${sesion.datos.nombre ?? "—"}\n` +
          `*Cédula:* ${sesion.datos.cedula ?? "—"}\n` +
          `*Teléfono:* ${sesion.datos.telefono ?? "—"}\n` +
          `*Boletas:* ${cant}\n` +
          `*Números:* ${cupones || "—"}\n` +
          `*Total:* ${gs(creada.montoTotal ?? monto)}\n` +
          `*Vendedor:* N.º ${sesion.datos.vendedor_numero ?? "—"}` +
          linkTicket +
          `\n\n_Escribí *#venta* para cargar otra._`
      );

      /**
       * Comprobante como imagen, para que el vendedor se lo reenvíe al comprador. Se arma
       * desde la venta ya registrada. Si falla, la venta igual quedó hecha: se avisa y no se
       * revierte nada.
       */
      try {
        const orderResult = await buildOrderResultFromEntradaId(supabase, creada.entradaId, empresaId);
        if (orderResult) {
          const flowData = await flowDataStubFromEntrada(supabase, creada.entradaId);
          await maybeGenerateAndSendSorteoTicketDelivery({
            supabase,
            empresaId,
            sorteoId: sorteo.id,
            entradaId: creada.entradaId,
            conversationId,
            flowSessionId: null,
            contactId: input.contactId ?? "",
            channelId: input.channelId ?? "",
            orderResult,
            flowData,
            trigger: "confirmacion_final",
          });
        }
      } catch (err) {
        console.error(LOG, "comprobante_no_enviado", err instanceof Error ? err.message : err);
      }

      return { manejado: true };
    }
  }

  return { manejado: false };
}
