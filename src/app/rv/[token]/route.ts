import { NextRequest, NextResponse } from "next/server";
import {
  REVENDEDOR_COOKIE,
  REVENDEDOR_COOKIE_MAX_AGE,
  resolveRevendedorByAccessToken,
} from "@/lib/sorteos/revendedor-session";

export const dynamic = "force-dynamic";

/**
 * GET /rv/:token — entrada del link mágico del revendedor.
 * Valida el token contra la BD, setea la cookie de sesión (httpOnly) y redirige al POS.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveRevendedorByAccessToken(token);

  // Redirect RELATIVO: detrás del proxy, request.url tiene el host interno (localhost).
  // Un Location relativo lo resuelve el browser contra el origin público real.
  if (!ctx) {
    return new NextResponse(null, { status: 303, headers: { Location: "/rv/invalido" } });
  }

  const res = new NextResponse(null, { status: 303, headers: { Location: "/rv" } });
  res.cookies.set(REVENDEDOR_COOKIE, token.trim(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: REVENDEDOR_COOKIE_MAX_AGE,
  });
  return res;
}
