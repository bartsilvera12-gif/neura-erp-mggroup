/**
 * Genera `src/app/favicon.ico` con la marca Z sobre un círculo del color de marca.
 *
 * Toma `public/brand/zentra-logo-official.png` (Z blanca + palabra ZENTRA sobre
 * transparente), recorta solo la Z y la centra en el círculo. Se deja como script para
 * poder regenerarlo si cambia el color o el logo.
 *
 * Uso:
 *   npx tsx scripts/generar-favicon.ts [--color "#21807C"] [--out src/app/favicon.ico]
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SIZES = [16, 32, 48, 64, 128, 256];
const FUENTE = "public/brand/zentra-logo-official.png";

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

/**
 * El PNG de marca trae la Z arriba y la palabra ZENTRA abajo, separadas por una franja
 * vacía. Se busca esa franja midiendo cuánta tinta hay por fila y se corta ahí.
 */
async function recortarSoloLaZ(src: Buffer): Promise<Buffer> {
  const recortado = await sharp(src).trim({ threshold: 40 }).png().toBuffer();
  const { data, info } = await sharp(recortado).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const filaConTinta: boolean[] = [];
  for (let y = 0; y < info.height; y++) {
    let suma = 0;
    for (let x = 0; x < info.width; x++) {
      suma += data[(y * info.width + x) * info.channels + 3]!;
    }
    filaConTinta.push(suma / info.width > 4);
  }

  /** Franja vacía más larga que empiece después del primer tercio: separa marca de palabra. */
  let mejorInicio = -1;
  let mejorLargo = 0;
  let inicio = -1;
  for (let y = Math.floor(info.height * 0.3); y < info.height; y++) {
    if (!filaConTinta[y]) {
      if (inicio < 0) inicio = y;
    } else if (inicio >= 0) {
      if (y - inicio > mejorLargo) {
        mejorLargo = y - inicio;
        mejorInicio = inicio;
      }
      inicio = -1;
    }
  }
  if (mejorInicio < 0 || mejorLargo < info.height * 0.03) {
    console.warn("No se encontró la franja vacía; se usa el logo completo.");
    return recortado;
  }
  const soloZ = await sharp(recortado)
    .extract({ left: 0, top: 0, width: info.width, height: mejorInicio })
    .png()
    .toBuffer();
  return recortarColumnasTenues(soloZ);
}

/**
 * `trim` conserva hairlines casi transparentes del arte y dejan la Z chica dentro de un
 * lienzo enorme. Se recorta a las columnas y filas con tinta real (>10% del máximo).
 */
async function recortarColumnasTenues(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colSum = new Array<number>(info.width).fill(0);
  const rowSum = new Array<number>(info.height).fill(0);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * info.channels + 3]!;
      colSum[x]! += a;
      rowSum[y]! += a;
    }
  }
  const limite = (arr: number[]) => Math.max(...arr) * 0.1;
  const rangoCon = (arr: number[]) => {
    const min = limite(arr);
    let a = arr.findIndex((v) => v > min);
    let b = arr.length - 1;
    while (b > a && arr[b]! <= min) b--;
    if (a < 0) a = 0;
    return { desde: a, hasta: b };
  };
  const cols = rangoCon(colSum);
  const filas = rangoCon(rowSum);
  return sharp(src)
    .extract({
      left: cols.desde,
      top: filas.desde,
      width: Math.max(1, cols.hasta - cols.desde + 1),
      height: Math.max(1, filas.hasta - filas.desde + 1),
    })
    .png()
    .toBuffer();
}

/** ICO: cabecera + una entrada por tamaño + los PNG embebidos (soportado desde Vista). */
function empaquetarIco(pngs: { size: number; buf: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entradas: Buffer[] = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entradas.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entradas, ...pngs.map((p) => p.buf)]);
}

async function main() {
  const color = arg("--color", "#21807C");
  const out = arg("--out", "src/app/favicon.ico");
  const outPng = arg("--out-png", "public/brand/favicon-512.png");

  if (!fs.existsSync(FUENTE)) throw new Error(`No se encontró ${FUENTE}`);
  const marca = await recortarSoloLaZ(fs.readFileSync(FUENTE));
  const meta = await sharp(marca).metadata();
  console.log(`Marca recortada: ${meta.width}×${meta.height}`);

  const render = async (size: number): Promise<Buffer> => {
    const r = size / 2;
    /** La Z ocupa ~58% del diámetro: deja aire y sigue legible a 16 px. */
    const zMax = Math.round(size * 0.62);
    const z = await sharp(marca)
      .resize(zMax, zMax, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const zMeta = await sharp(z).metadata();
    const circulo = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
         <circle cx="${r}" cy="${r}" r="${r}" fill="${color}"/>
       </svg>`
    );
    return sharp(circulo)
      .composite([
        {
          input: z,
          left: Math.round((size - (zMeta.width ?? zMax)) / 2),
          top: Math.round((size - (zMeta.height ?? zMax)) / 2),
        },
      ])
      .png({ compressionLevel: 9 })
      .toBuffer();
  };

  const pngs = [];
  for (const size of SIZES) pngs.push({ size, buf: await render(size) });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, empaquetarIco(pngs));
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, await render(512));

  console.log("Listo:");
  console.log(`  ${out} (${SIZES.join(", ")} px)`);
  console.log(`  ${outPng} (512 px)`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
