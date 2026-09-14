/**
 * Pruebas del seguimiento de cada foto de boleto.
 *
 * Reproduce la orden 313: tres boletos, Meta acepta las tres fotos, llegan dos y la tercera
 * vuelve `failed` por webhook. Antes la entrega quedaba «enviada» y nadie se enteraba.
 *
 * Correr con: npx tsx scripts/qa-boletos-entrega.ts
 */
import {
  aplicarEstadoAImagen,
  estadoDeFilaSegunImagenes,
  imagenesParaReenviar,
  leerImagenesDeBoleto,
  reconstruirImagenesDesdeMensajes,
  registrarEnvioDeImagen,
  registrarFalloDeEnvio,
  resumirImagenes,
  tocaReintentoAutomatico,
  type ImagenBoleto,
} from "@/lib/sorteos/sorteo-ticket-imagenes";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

const BASE = "e/s/entrada-rev1";
const PIE = "Orden Nº 313 — Nissan Frontier";
const NUMEROS = ["4832", "5564", "8753"];

const foto = (n: number) => ({
  n,
  de: 3,
  numero: NUMEROS[n - 1],
  storage_path: `${BASE}-${n}.png`,
  pie: `${PIE} — Boleto ${n} de 3 · N.º ${NUMEROS[n - 1]}`,
});

/** Las tres fotos aceptadas por Meta, como las deja el envío. */
let imgs: ImagenBoleto[] = [];
for (const n of [1, 2, 3]) {
  imgs = registrarEnvioDeImagen(imgs, { ...foto(n), wa_message_id: `wamid.${n}` });
}

console.log("\nOrden 313: Meta acepta las tres");
{
  chequear("quedan las tres anotadas", imgs.length === 3 && imgs.every((i) => i.estado === "aceptado"), imgs);
  chequear("cada una con su id de mensaje", imgs.map((i) => i.wa_message_id).join() === "wamid.1,wamid.2,wamid.3");
  const r = resumirImagenes(imgs);
  chequear("ninguna se da por entregada todavía", r.entregadas === 0 && r.sin_confirmar === 3, r);
}

console.log("\nLlegan los avisos de Meta: 1 y 2 entregadas, 3 falla");
{
  for (const n of [1, 2, 3]) imgs = aplicarEstadoAImagen(imgs, `wamid.${n}`, "sent").imagenes;
  imgs = aplicarEstadoAImagen(imgs, "wamid.1", "delivered").imagenes;
  imgs = aplicarEstadoAImagen(imgs, "wamid.2", "delivered").imagenes;
  const r3 = aplicarEstadoAImagen(imgs, "wamid.3", "failed", {
    errorCode: "131056",
    error: "Pair rate limit hit",
  });
  imgs = r3.imagenes;
  chequear("el fallo se anota en la tercera", r3.cambio && r3.imagen?.n === 3 && r3.imagen.estado === "failed");
  chequear("con el código de Meta", r3.imagen?.error_code === "131056", r3.imagen);

  const r = resumirImagenes(imgs);
  chequear("2 de 3 entregadas", r.entregadas === 2 && r.total === 3, r);
  chequear("se sabe cuál no llegó", r.numeros_fallidos.join() === "8753", r);
  chequear("le toca un reintento automático", tocaReintentoAutomatico(r3.imagen!));
  chequear(
    "mientras se reintenta, la fila no pasa a error",
    estadoDeFilaSegunImagenes(imgs).status === "sent"
  );
  chequear(
    "reenviar a mano manda solo la 3",
    imagenesParaReenviar(imgs).map((i) => i.n).join() === "3",
    imagenesParaReenviar(imgs)
  );

  const repetido = aplicarEstadoAImagen(imgs, "wamid.3", "failed");
  chequear("un aviso repetido no dispara otro reintento", !repetido.cambio);
}

console.log("\nEl reintento automático también falla");
{
  imgs = registrarEnvioDeImagen(imgs, { ...foto(3), wa_message_id: "wamid.3b" });
  const tercera = imgs.find((i) => i.n === 3)!;
  chequear("el reintento reemplaza el id y cuenta el envío", tercera.wa_message_id === "wamid.3b" && tercera.envios === 2, tercera);
  chequear("la fila vuelve a estar bien mientras tanto", estadoDeFilaSegunImagenes(imgs).status === "sent");

  const r = aplicarEstadoAImagen(imgs, "wamid.3b", "failed", { errorCode: "131026", error: "Message undeliverable" });
  imgs = r.imagenes;
  chequear("no hay un segundo reintento automático", !tocaReintentoAutomatico(r.imagen!));
  const fila = estadoDeFilaSegunImagenes(imgs);
  chequear("la fila queda en error", fila.status === "error", fila);
  chequear(
    "el error dice qué boleto no llegó",
    (fila.error_message ?? "").includes("boleto 3 de 3") && (fila.error_message ?? "").includes("8753"),
    fila.error_message
  );
  chequear(
    "un aviso del id viejo ya no mueve nada",
    !aplicarEstadoAImagen(imgs, "wamid.3", "delivered").cambio
  );
}

console.log("\nLos avisos no hacen retroceder el estado");
{
  let x = registrarEnvioDeImagen([], { ...foto(1), wa_message_id: "w1" });
  x = aplicarEstadoAImagen(x, "w1", "read").imagenes;
  chequear("un «sent» atrasado no pisa «read»", !aplicarEstadoAImagen(x, "w1", "sent").cambio);
  chequear("un «failed» después de leída no la marca fallida", !aplicarEstadoAImagen(x, "w1", "failed").cambio);
  chequear("un id que no es de la entrega no toca nada", !aplicarEstadoAImagen(x, "otro", "failed").cambio);

  let y = registrarEnvioDeImagen([], { ...foto(1), wa_message_id: "w2" });
  y = aplicarEstadoAImagen(y, "w2", "failed").imagenes;
  const tarde = aplicarEstadoAImagen(y, "w2", "delivered");
  chequear("si al final llegó, el «delivered» corrige el fallo", tarde.cambio && tarde.imagen?.estado === "delivered");
}

console.log("\nMeta rechaza la foto en el momento");
{
  let x: ImagenBoleto[] = [];
  x = registrarEnvioDeImagen(x, { ...foto(1), wa_message_id: "w1" });
  x = registrarFalloDeEnvio(x, foto(2), "(#131056) pair rate limit");
  x = registrarEnvioDeImagen(x, { ...foto(3), wa_message_id: "w3" });
  const segunda = x.find((i) => i.n === 2)!;
  chequear("queda anotada como fallida", segunda.estado === "failed" && segunda.wa_message_id === null, segunda);
  chequear("sin otro reintento automático (ya se reintentó en el momento)", !tocaReintentoAutomatico(segunda));
  chequear("la tanda siguió: la 3 se mandó", x.find((i) => i.n === 3)?.wa_message_id === "w3");
  chequear("la fila va a error", estadoDeFilaSegunImagenes(x).status === "error");
}

console.log("\nSi llegaron todas, reenviar las manda todas");
{
  let x: ImagenBoleto[] = [];
  for (const n of [1, 2, 3]) {
    x = registrarEnvioDeImagen(x, { ...foto(n), wa_message_id: `w${n}` });
    x = aplicarEstadoAImagen(x, `w${n}`, "delivered").imagenes;
  }
  chequear("las tres", imagenesParaReenviar(x).length === 3);
}

console.log("\nEntregas de antes de este cambio (como la orden 313 real)");
{
  const recon = reconstruirImagenesDesdeMensajes({
    storagePathPrimera: `${BASE}-1.png`,
    numeros: NUMEROS,
    pieBase: PIE,
    mensajes: [
      { content: `Ticket imagen\n${PIE} — Boleto 1 de 3 · N.º 4832`, wa_message_id: "a", estado: "read" },
      { content: `Ticket imagen\n${PIE} — Boleto 2 de 3 · N.º 5564`, wa_message_id: "b", estado: "delivered" },
      { content: `Ticket imagen\n${PIE} — Boleto 3 de 3 · N.º 8753`, wa_message_id: "c", estado: "failed" },
    ],
  });
  chequear("arma las tres imágenes", recon.length === 3, recon);
  chequear(
    "con el archivo de cada una",
    recon.map((i) => i.storage_path).join() === `${BASE}-1.png,${BASE}-2.png,${BASE}-3.png`
  );
  chequear("toma el estado que dejó Meta", recon.map((i) => i.estado).join() === "read,delivered,failed");
  chequear("reenviar manda solo la 8753", imagenesParaReenviar(recon).map((i) => i.numero).join() === "8753");
  chequear("el pie es el mismo de siempre", recon[2].pie === `${PIE} — Boleto 3 de 3 · N.º 8753`, recon[2].pie);

  /** Si Meta dejó la tercera en «sent» (nunca confirmó la entrega), también se reenvía. */
  const sinConfirmar = reconstruirImagenesDesdeMensajes({
    storagePathPrimera: `${BASE}-1.png`,
    numeros: NUMEROS,
    pieBase: PIE,
    mensajes: [
      { content: `x — Boleto 1 de 3 · N.º 4832`, wa_message_id: "a", estado: "read" },
      { content: `x — Boleto 2 de 3 · N.º 5564`, wa_message_id: "b", estado: "read" },
      { content: `x — Boleto 3 de 3 · N.º 8753`, wa_message_id: "c", estado: "sent" },
    ],
  });
  chequear("una foto sin confirmar también se reenvía", imagenesParaReenviar(sinConfirmar).map((i) => i.n).join() === "3");

  const faltante = reconstruirImagenesDesdeMensajes({
    storagePathPrimera: `${BASE}-1.png`,
    numeros: NUMEROS,
    pieBase: PIE,
    mensajes: [{ content: `x — Boleto 1 de 3 · N.º 4832`, wa_message_id: "a", estado: "delivered" }],
  });
  chequear(
    "las que no tienen mensaje se dan por no enviadas",
    imagenesParaReenviar(faltante).map((i) => i.n).join() === "2,3",
    faltante
  );

  const unaSola = reconstruirImagenesDesdeMensajes({
    storagePathPrimera: `${BASE}.png`,
    numeros: ["4832"],
    pieBase: PIE,
    mensajes: [{ content: "Ticket imagen", wa_message_id: "a", estado: "delivered" }],
  });
  chequear("compra de un boleto: una imagen", unaSola.length === 1 && unaSola[0].storage_path === `${BASE}.png`);
}

console.log("\nLectura robusta de lo guardado");
{
  chequear("sin payload", leerImagenesDeBoleto(null).length === 0);
  chequear("sin lista", leerImagenesDeBoleto({ cupones: ["1"] }).length === 0);
  chequear(
    "descarta basura y ordena",
    leerImagenesDeBoleto({
      imagenes: [{ n: 2, de: 2, storage_path: "b" }, "x", { n: 0, storage_path: "z" }, { n: 1, de: 2, storage_path: "a" }],
    })
      .map((i) => i.n)
      .join() === "1,2"
  );
  chequear(
    "un estado desconocido se toma como aceptado",
    leerImagenesDeBoleto({ imagenes: [{ n: 1, storage_path: "a", estado: "raro" }] })[0].estado === "aceptado"
  );
}

console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
process.exit(fallas === 0 ? 0 : 1);
