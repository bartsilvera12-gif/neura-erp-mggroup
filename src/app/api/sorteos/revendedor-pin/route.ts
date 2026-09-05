import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getSingleClientSchemaOrNull } from "@/lib/instance/single-client";
import { readRevendedorSession } from "@/lib/sorteos/revendedor-session";
import { verificarPin } from "@/lib/sorteos/vendedor-pin";
import {
  RV_PIN_COOKIE,
  RV_PIN_MAX_AGE,
  construirValorDesbloqueo,
} from "@/lib/sorteos/revendedor-pin-session";

export const dynamic = "force-dynamic";

/**
 * Freno a la fuerza bruta. Un PIN de 4 dígitos son 10.000 combinaciones: sin esto, un script
 * las prueba todas en minutos.
 *
 * Vive en memoria del proceso a propósito: este despliegue corre un único proceso Node de
 * larga vida, así que alcanza y evita otra migración. Si algún día se escala a varias
 * instancias, hay que moverlo a la base — con varias réplicas, cada una contaría aparte.
 */
const intentos = new Map<string, { fallos: number; hasta: number }>();
const MAX_FALLOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;

function bloqueadoHasta(id: string): number {
  const e = intentos.get(id);
  if (!e) return 0;
  if (e.hasta > Date.now()) return e.hasta;
  if (e.hasta !== 0 && e.hasta <= Date.now()) intentos.delete(id);
  return 0;
}

function registrarFallo(id: string): void {
  const e = intentos.get(id) ?? { fallos: 0, hasta: 0 };
  e.fallos += 1;
  if (e.fallos >= MAX_FALLOS) {
    e.hasta = Date.now() + BLOQUEO_MS;
    e.fallos = 0;
  }
  intentos.set(id, e);
}

/** POST /api/sorteos/revendedor-pin — valida el PIN y desbloquea el POS. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await readRevendedorSession();
    if (!ctx) {
      return NextResponse.json(
        errorResponse("Tu sesión no es válida. Volvé a abrir tu link."),
        { status: 401 }
      );
    }
    if (!ctx.exigePin) {
      return NextResponse.json(successResponse({ desbloqueado: true }));
    }

    const hasta = bloqueadoHasta(ctx.revendedorId);
    if (hasta > 0) {
      const min = Math.max(1, Math.ceil((hasta - Date.now()) / 60000));
      return NextResponse.json(
        errorResponse(`Demasiados intentos. Probá de nuevo en ${min} minuto(s).`),
        { status: 429 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!pin) {
      return NextResponse.json(errorResponse("Ingresá tu PIN."), { status: 400 });
    }

    const pool = getChatPostgresPool();
    const schema = getSingleClientSchemaOrNull();
    if (!pool || !schema) {
      return NextResponse.json(errorResponse("Servidor sin conexión directa a Postgres."), {
        status: 503,
      });
    }

    /** El hash se lee acá y no viaja en el contexto de sesión, que circula por muchos lados. */
    const t = quoteSchemaTable(schema, "sorteo_revendedores");
    const r = await pool.query<{ pin_hash: string | null }>(
      `SELECT pin_hash FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [ctx.revendedorId, ctx.empresaId]
    );

    if (!verificarPin(pin, r.rows[0]?.pin_hash)) {
      registrarFallo(ctx.revendedorId);
      return NextResponse.json(errorResponse("PIN incorrecto."), { status: 401 });
    }

    intentos.delete(ctx.revendedorId);

    const res = NextResponse.json(successResponse({ desbloqueado: true }));
    res.cookies.set({
      name: RV_PIN_COOKIE,
      value: construirValorDesbloqueo(ctx.revendedorId, ctx.pinActualizadoAt),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: RV_PIN_MAX_AGE,
    });
    return res;
  } catch (e) {
    console.error("[api/sorteos/revendedor-pin]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo validar el PIN."), { status: 500 });
  }
}
