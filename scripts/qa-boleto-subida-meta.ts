/**
 * El boleto se sube a Meta y se manda por id, no por link.
 *
 * Con link, Meta baja la imagen después de aceptar el mensaje; si esa bajada falla, el boleto
 * vuelve `failed` con 131053 y no llega (orden 313, boleto 3). Se prueba con un Meta simulado.
 *
 * Correr con: npx tsx --conditions=react-server scripts/qa-boleto-subida-meta.ts
 */
import { enviarImagenPorWhatsapp } from "@/lib/sorteos/sorteo-ticket-envio-imagenes";

let fallas = 0;
const chequear = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log("  ok   " + n);
  else {
    fallas++;
    console.log("  FALLA " + n, d ?? "");
  }
};

type Llamada = { url: string; body: unknown };
let llamadas: Llamada[] = [];
let subidaFalla = false;
let storageFalla = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  llamadas.push({ url, body: init?.body });
  const json = (status: number, obj: unknown) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("storage.test")) {
    return storageFalla ? new Response("no", { status: 500 }) : new Response(new Uint8Array([137, 80, 78, 71]));
  }
  if (url.endsWith("/media")) {
    return subidaFalla ? json(400, { error: { message: "Invalid parameter" } }) : json(200, { id: "MEDIA123" });
  }
  if (url.endsWith("/messages")) return json(200, { messages: [{ id: "wamid.OK" }] });
  return new Response("?", { status: 404 });
}) as typeof fetch;

const outbound = {
  provider: "meta",
  phoneNumberId: "PNID",
  accessToken: "TOKEN",
  toDigits: "595993513020",
} as unknown as Parameters<typeof enviarImagenPorWhatsapp>[0];

const URL_FIRMADA = "https://storage.test/boleto-3.png?token=x";

async function main() {
  console.log("\nCon el PNG a mano");
  {
    llamadas = [];
    const r = await enviarImagenPorWhatsapp(outbound, URL_FIRMADA, "Boleto 3 de 3 · N.º 8753", new Uint8Array([1, 2, 3]));
    chequear("sale bien con el id de mensaje", r.ok && r.waMessageId === "wamid.OK", r);
    chequear("primero sube a Meta", llamadas[0]?.url === "https://graph.facebook.com/v19.0/PNID/media", llamadas);
    const form = llamadas[0]?.body as FormData;
    chequear("sube el archivo como png", form?.get("type") === "image/png" && form?.get("file") instanceof Blob);
    chequear("con messaging_product", form?.get("messaging_product") === "whatsapp");
    const envio = JSON.parse(String(llamadas[1]?.body ?? "{}"));
    chequear("manda la imagen por id", envio.image?.id === "MEDIA123" && !envio.image?.link, envio);
    chequear("con el pie", envio.image?.caption === "Boleto 3 de 3 · N.º 8753", envio);
    chequear("no pasa por el Storage", !llamadas.some((l) => l.url.includes("storage.test")));
  }

  console.log("\nSin el PNG (reenvío): lo baja del Storage y lo sube");
  {
    llamadas = [];
    const r = await enviarImagenPorWhatsapp(outbound, URL_FIRMADA, "pie");
    chequear("sale bien", r.ok && r.waMessageId === "wamid.OK", r);
    chequear("bajó, subió, mandó", llamadas.map((l) => l.url.split("/").pop()).join(" ") === "boleto-3.png?token=x media messages", llamadas.map((l) => l.url));
    const envio = JSON.parse(String(llamadas[2]?.body ?? "{}"));
    chequear("por id", envio.image?.id === "MEDIA123", envio);
  }

  console.log("\nSi la subida a Meta falla, se usa el link como antes");
  {
    llamadas = [];
    subidaFalla = true;
    const r = await enviarImagenPorWhatsapp(outbound, URL_FIRMADA, "pie", new Uint8Array([1]));
    subidaFalla = false;
    const envio = JSON.parse(String(llamadas[llamadas.length - 1]?.body ?? "{}"));
    chequear("igual sale", r.ok, r);
    chequear("por link", envio.image?.link === URL_FIRMADA && !envio.image?.id, envio);
  }

  console.log("\nSi no se puede bajar del Storage, también se usa el link");
  {
    llamadas = [];
    storageFalla = true;
    const r = await enviarImagenPorWhatsapp(outbound, URL_FIRMADA, "pie");
    storageFalla = false;
    const envio = JSON.parse(String(llamadas[llamadas.length - 1]?.body ?? "{}"));
    chequear("igual sale, por link", r.ok && envio.image?.link === URL_FIRMADA, envio);
  }

  console.log(fallas === 0 ? "\nTodo bien.\n" : `\n${fallas} falla(s).\n`);
}
void main().then(() => process.exit(fallas === 0 ? 0 : 1));
