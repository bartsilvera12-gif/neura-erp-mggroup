/**
 * Pruebas de la precarga de datos del comprador que vuelve.
 *
 * Lo que se verifica acá es lo que puede romper el bot: que la precarga use las claves reales
 * del flujo, que no pise lo que la persona acaba de escribir, y sobre todo que cada campo se
 * saltee UNA sola vez, para que «corregir datos» no quede girando en el mismo paso.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-sorteo-datos-guardados.ts
 */
import {
  BOTONES_DATOS_GUARDADOS,
  leerPendientes,
  planificarPrecargaDeDatos,
  type DatosGuardadosComprador,
} from "@/lib/chat/sorteo-datos-guardados";
import type {
  FlowCaptureGraphContext,
  FlowNodeRowLite,
} from "@/lib/sorteos/sorteo-flow-capture-order";

let fallas = 0;
function chequear(nombre: string, ok: boolean, detalle?: unknown) {
  if (ok) {
    console.log(`  ok   ${nombre}`);
    return;
  }
  fallas++;
  console.log(`  FALLA ${nombre}`, detalle ?? "");
}

function grafo(nodos: Array<Partial<FlowNodeRowLite> & { node_code: string }>): FlowCaptureGraphContext {
  const completos: FlowNodeRowLite[] = nodos.map((n, i) => ({
    id: `id-${i}`,
    node_code: n.node_code,
    node_type: n.node_type ?? "text",
    message_text: n.message_text ?? null,
    save_as_field: n.save_as_field ?? null,
    next_node_code: n.next_node_code ?? null,
    sort_order: n.sort_order ?? i,
  }));
  return {
    order: completos.map((n) => n.node_code),
    nodesByCode: new Map(completos.map((n) => [n.node_code, n])),
  };
}

const DATOS: DatosGuardadosComprador = {
  nombre: "María Fernanda Villalba",
  documento: "4567890",
  ciudad: "Encarnación",
};

console.log("\nUn flujo con nombre completo, cédula y ciudad");
{
  const ctx = grafo([
    { node_code: "cantidad", node_type: "buttons" },
    { node_code: "nombre", save_as_field: "nombre_completo" },
    { node_code: "cedula", save_as_field: "cedula" },
    { node_code: "ciudad", save_as_field: "ciudad" },
    { node_code: "pago", node_type: "text" },
  ]);
  const plan = planificarPrecargaDeDatos(ctx, {}, DATOS);
  chequear("usa las claves del flujo", plan.valores.nombre_completo === "María Fernanda Villalba", plan.valores);
  chequear("carga la cédula", plan.valores.cedula === "4567890", plan.valores);
  chequear("carga la ciudad", plan.valores.ciudad === "Encarnación", plan.valores);
  chequear(
    "los pendientes van en orden de flujo",
    plan.pendientes.join(",") === "nombre_completo,cedula,ciudad",
    plan.pendientes
  );
  chequear("no toca nodos sin save_as_field", plan.valores.pago === undefined, plan.valores);
}

console.log("\nUn flujo que separa nombre y apellido");
{
  const ctx = grafo([
    { node_code: "nombre", save_as_field: "nombre" },
    { node_code: "apellido", save_as_field: "apellido" },
    { node_code: "doc", save_as_field: "documento" },
  ]);
  const plan = planificarPrecargaDeDatos(ctx, {}, DATOS);
  chequear("el nombre es solo el primero", plan.valores.nombre === "María", plan.valores);
  chequear("el resto va al apellido", plan.valores.apellido === "Fernanda Villalba", plan.valores);
  chequear("la cédula entra como «documento»", plan.valores.documento === "4567890", plan.valores);
}

console.log("\nUn flujo de un solo campo no parte el nombre");
{
  const ctx = grafo([{ node_code: "nombre", save_as_field: "nombre" }]);
  const plan = planificarPrecargaDeDatos(ctx, {}, DATOS);
  chequear("queda el nombre completo", plan.valores.nombre === "María Fernanda Villalba", plan.valores);
}

console.log("\nLo que la persona ya escribió manda");
{
  const ctx = grafo([
    { node_code: "nombre", save_as_field: "nombre_completo" },
    { node_code: "cedula", save_as_field: "cedula" },
    { node_code: "ciudad", save_as_field: "ciudad" },
  ]);
  const plan = planificarPrecargaDeDatos(ctx, { nombre_completo: "Juan Otro" }, DATOS);
  chequear("no pisa el nombre escrito", plan.valores.nombre_completo === undefined, plan.valores);
  chequear("no lo pone entre los pendientes", !plan.pendientes.includes("nombre_completo"), plan.pendientes);
  chequear("los demás sí se precargan", plan.pendientes.join(",") === "cedula,ciudad", plan.pendientes);
}

console.log("\nSin ciudad guardada no se inventa nada");
{
  const ctx = grafo([
    { node_code: "nombre", save_as_field: "nombre_completo" },
    { node_code: "ciudad", save_as_field: "ciudad" },
  ]);
  const plan = planificarPrecargaDeDatos(ctx, {}, { ...DATOS, ciudad: "" });
  chequear("la ciudad queda sin precargar", plan.valores.ciudad === undefined, plan.valores);
  chequear("y se sigue preguntando", !plan.pendientes.includes("ciudad"), plan.pendientes);
}

console.log("\nQué se pregunta según lo que conteste el comprador");
{
  const ctx = grafo([
    { node_code: "nombre", save_as_field: "nombre_completo", next_node_code: "cedula" },
    { node_code: "cedula", save_as_field: "cedula", next_node_code: "ciudad" },
    { node_code: "ciudad", save_as_field: "ciudad", next_node_code: "pago" },
  ]);
  const plan = planificarPrecargaDeDatos(ctx, {}, DATOS);

  /**
   * Misma cuenta que hace el motor: se saltea el paso solo si el comprador confirmó Y el campo
   * sigue en la lista de pendientes; al saltearlo, sale de esa lista.
   */
  const recorrer = (estado: { pendientes: string[]; confirmada: boolean }) => {
    const preguntados: string[] = [];
    for (const code of ctx.order) {
      const campo = ctx.nodesByCode.get(code)?.save_as_field ?? "";
      if (estado.confirmada && estado.pendientes.includes(campo)) {
        estado.pendientes = estado.pendientes.filter((c) => c !== campo);
        continue;
      }
      preguntados.push(campo);
    }
    return preguntados;
  };

  const sinContestar = { pendientes: plan.pendientes.slice(), confirmada: false };
  chequear(
    "si no contesta, se le pregunta todo (nunca queda esperando un botón)",
    recorrer(sinContestar).join(",") === "nombre_completo,cedula,ciudad"
  );

  const confirmo = { pendientes: plan.pendientes.slice(), confirmada: true };
  chequear("si confirma, no se le pregunta nada", recorrer(confirmo).length === 0);
  chequear(
    "y si después vuelve atrás a corregir, se le pregunta todo",
    recorrer(confirmo).join(",") === "nombre_completo,cedula,ciudad"
  );

  /** «Cargar otros datos» vacía la lista de pendientes. */
  const pidioCambiar = { pendientes: [] as string[], confirmada: false };
  chequear(
    "si pide cargar otros, se le pregunta todo",
    recorrer(pidioCambiar).join(",") === "nombre_completo,cedula,ciudad"
  );
}

console.log("\nLos botones de la confirmación");
{
  chequear(
    "tienen ids distintos",
    BOTONES_DATOS_GUARDADOS.confirmar !== BOTONES_DATOS_GUARDADOS.cambiar
  );
  /** WhatsApp corta los ids de botón en 256 caracteres. */
  chequear(
    "los ids entran en lo que acepta WhatsApp",
    BOTONES_DATOS_GUARDADOS.confirmar.length <= 256 &&
      BOTONES_DATOS_GUARDADOS.cambiar.length <= 256
  );
}

console.log("\nLectura de la lista de pendientes");
{
  chequear("lista vacía", leerPendientes({}).length === 0);
  chequear("ignora espacios y comas sueltas", leerPendientes({ sorteo_datos_precarga_pendientes: " a , ,b " }).join(",") === "a,b");
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
