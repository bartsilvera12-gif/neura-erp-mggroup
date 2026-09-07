/**
 * Pruebas de las dos defensas nuevas del comprobante:
 *
 *  1. Detección de mensaje reenviado (`context.forwarded` de WhatsApp).
 *  2. Configuración del rechazo de reenviados: prendido salvo que lo apaguen explícitamente.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-comprobante-reenviado.ts
 */
import { mensajeLlegoReenviado } from "@/lib/chat/flow-engine-service";
import {
  defaultComprobanteValidationSettings,
  parseComprobanteValidationConfig,
} from "@/lib/chat/comprobante-validation-types";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

console.log("\n¿El mensaje llegó reenviado?");
{
  chequear("reenviado", mensajeLlegoReenviado({ context: { forwarded: true } }));
  chequear(
    "reenviado muchas veces",
    mensajeLlegoReenviado({ context: { frequently_forwarded: true } })
  );
  chequear("mensaje normal", !mensajeLlegoReenviado({ id: "wamid.x", type: "image" }));
  chequear(
    "respuesta a otro mensaje no es reenvío",
    !mensajeLlegoReenviado({ context: { id: "wamid.y", from: "5959..." } })
  );
  chequear(
    "forwarded en false",
    !mensajeLlegoReenviado({ context: { forwarded: false, frequently_forwarded: false } })
  );
  chequear("sin payload", !mensajeLlegoReenviado(null) && !mensajeLlegoReenviado(undefined));
  /** WhatsApp manda booleanos; un string no se toma como verdadero. */
  chequear("context basura", !mensajeLlegoReenviado({ context: "forwarded" }));
  chequear("forwarded como texto", !mensajeLlegoReenviado({ context: { forwarded: "true" } }));
}

console.log("\nConfiguración del rechazo de reenviados");
{
  chequear("prendido de fábrica", defaultComprobanteValidationSettings().rechazar_comprobante_reenviado);
  chequear(
    "un canal viejo, sin la clave, queda protegido",
    parseComprobanteValidationConfig({ comprobante_validation: { enabled: true } })
      .rechazar_comprobante_reenviado
  );
  chequear(
    "se puede apagar a propósito",
    parseComprobanteValidationConfig({
      comprobante_validation: { enabled: true, rechazar_comprobante_reenviado: false },
    }).rechazar_comprobante_reenviado === false
  );
  chequear(
    "hay mensaje para el comprador",
    defaultComprobanteValidationSettings().messages.comprobante_reenviado.length > 20
  );
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
