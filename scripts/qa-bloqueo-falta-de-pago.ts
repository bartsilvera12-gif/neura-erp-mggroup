/**
 * Corte del servicio por falta de pago.
 *
 * Lo que se verifica: que una empresa marcada quede bloqueada, que al desmarcarla vuelva a
 * entrar, que un error de base NO bloquee a nadie (fallar abierto) y que el super admin de
 * Neura nunca quede afuera, que es quien tiene que poder desbloquear.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-bloqueo-falta-de-pago.ts
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  empresaConAccesoBloqueado,
  leerEstadoDeAcceso,
  olvidarEstadoDeAcceso,
  rolIgnoraBloqueo,
} from "@/lib/empresas/acceso-bloqueado";
import { MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI } from "@/lib/empresas/mensaje-bloqueo";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

type Fila = { acceso_bloqueado?: boolean | null; acceso_bloqueado_mensaje?: string | null };

/** Catálogo de mentira; `consultas` cuenta cuántas veces se fue a la base. */
function baseFalsa(fila: Fila | null, opciones: { error?: string } = {}) {
  const estado = { consultas: 0 };
  const from = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = chain;
    q.maybeSingle = async () => {
      estado.consultas++;
      if (opciones.error) return { data: null, error: { message: opciones.error } };
      return { data: fila, error: null };
    };
    return q;
  };
  return { sb: { from } as unknown as AppSupabaseClient, estado };
}

const EMPRESA = "3648b53f-eb6e-413a-994a-a86d7d306aa9";

async function main() {
  console.log("\nEmpresa al día");
  {
    olvidarEstadoDeAcceso();
    const { sb } = baseFalsa({ acceso_bloqueado: false });
    const r = await leerEstadoDeAcceso(EMPRESA, sb);
    chequear("entra normal", r.bloqueada === false && r.mensaje === "", r);
  }

  console.log("\nEmpresa cortada por falta de pago");
  {
    olvidarEstadoDeAcceso();
    const { sb } = baseFalsa({ acceso_bloqueado: true });
    const r = await leerEstadoDeAcceso(EMPRESA, sb);
    chequear("queda bloqueada", r.bloqueada === true, r);
    chequear("con el mensaje de siempre", r.mensaje === MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI, r.mensaje);
    chequear("dice por qué y que se reactiva solo", /falta de pago/i.test(r.mensaje) && /autom/i.test(r.mensaje));
  }

  console.log("\nMensaje propio de la empresa");
  {
    olvidarEstadoDeAcceso();
    const { sb } = baseFalsa({ acceso_bloqueado: true, acceso_bloqueado_mensaje: "Hablá con Juan." });
    chequear("se usa el texto cargado", (await leerEstadoDeAcceso(EMPRESA, sb)).mensaje === "Hablá con Juan.");
  }

  console.log("\nDesbloquear: vuelve a la normalidad");
  {
    olvidarEstadoDeAcceso();
    const bloqueada = baseFalsa({ acceso_bloqueado: true });
    chequear("primero bloqueada", await empresaConAccesoBloqueado(EMPRESA, bloqueada.sb));
    const libre = baseFalsa({ acceso_bloqueado: false });
    olvidarEstadoDeAcceso(EMPRESA);
    chequear("después del desbloqueo entra", (await empresaConAccesoBloqueado(EMPRESA, libre.sb)) === false);
  }

  console.log("\nUn error de base no deja afuera a un cliente al día");
  {
    olvidarEstadoDeAcceso();
    const sinColumnas = baseFalsa(null, { error: 'column "acceso_bloqueado" does not exist' });
    chequear("sin la migración todavía: pasa", (await empresaConAccesoBloqueado(EMPRESA, sinColumnas.sb)) === false);
    olvidarEstadoDeAcceso();
    const caida = baseFalsa(null, { error: "timeout" });
    chequear("con la base caída: pasa", (await empresaConAccesoBloqueado(EMPRESA, caida.sb)) === false);
    olvidarEstadoDeAcceso();
    const sinFila = baseFalsa(null);
    chequear("empresa inexistente: pasa", (await empresaConAccesoBloqueado(EMPRESA, sinFila.sb)) === false);
    chequear("sin empresa no se consulta nada", (await empresaConAccesoBloqueado(null)) === false);
  }

  console.log("\nNo se consulta la base en cada request");
  {
    olvidarEstadoDeAcceso();
    const { sb, estado } = baseFalsa({ acceso_bloqueado: true });
    for (let i = 0; i < 5; i++) await empresaConAccesoBloqueado(EMPRESA, sb);
    chequear("5 llamadas, 1 sola consulta", estado.consultas === 1, estado);
    olvidarEstadoDeAcceso(EMPRESA);
    await empresaConAccesoBloqueado(EMPRESA, sb);
    chequear("al desbloquear se vuelve a consultar", estado.consultas === 2, estado);
  }

  console.log("\nQuién nunca queda afuera");
  {
    chequear("super admin de Neura", rolIgnoraBloqueo("super_admin"));
    chequear("admin del cliente no", !rolIgnoraBloqueo("admin"));
    chequear("sin rol tampoco", !rolIgnoraBloqueo(null) && !rolIgnoraBloqueo(""));
  }

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
