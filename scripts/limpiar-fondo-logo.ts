/**
 * Quita el fondo oscuro de un logo y lo deja como PNG con transparencia.
 *
 * Pensado para logos claros sobre negro (dorado, blanco, neón): la opacidad de cada
 * píxel se deriva de su luminancia, así el degradado y el brillo del borde se conservan
 * en vez de quedar un recorte con serrucho.
 *
 * Uso:
 *   npx tsx scripts/limpiar-fondo-logo.ts --input logo.jpg [--output logo.png]
 *                                         [--min 28] [--max 96] [--sin-recorte]
 *
 *   --min  luminancia (0-255) totalmente transparente. Subilo si queda halo gris.
 *   --max  luminancia totalmente opaca. Bajalo si el logo queda semitransparente.
 */

import path from "node:path";
import sharp from "sharp";

type Args = { input: string; output: string; min: number; max: number; recortar: boolean };

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--input") ?? get("-i");
  if (!input) {
    throw new Error("Falta --input <archivo>. Ej: npx tsx scripts/limpiar-fondo-logo.ts --input logo.jpg");
  }
  const parsed = path.parse(input);
  const output = get("--output") ?? get("-o") ?? path.join(parsed.dir, `${parsed.name}-sin-fondo.png`);
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  return {
    input,
    output,
    min: num(get("--min"), 28),
    max: num(get("--max"), 96),
    recortar: !argv.includes("--sin-recorte"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.max <= args.min) throw new Error("--max tiene que ser mayor que --min");

  const { data, info } = await sharp(args.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const salida = Buffer.alloc(data.length);
  let transparentes = 0;

  for (let i = 0; i < px; i++) {
    const o = i * info.channels;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const a = data[o + 3]!;
    /** Luminancia percibida (Rec. 601): el dorado pesa más que el azul del mismo brillo. */
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let alpha: number;
    if (lum <= args.min) alpha = 0;
    else if (lum >= args.max) alpha = 255;
    else alpha = Math.round(((lum - args.min) / (args.max - args.min)) * 255);
    if (alpha === 0) transparentes++;
    salida[o] = r;
    salida[o + 1] = g;
    salida[o + 2] = b;
    salida[o + 3] = Math.round((alpha * a) / 255);
  }

  let img = sharp(salida, { raw: { width: info.width, height: info.height, channels: info.channels } });
  if (args.recortar) {
    /** Recorta el marco vacío para que el logo llene el espacio que le da el comprobante. */
    img = img.png().trim({ threshold: 1 });
  }
  const buf = await img.png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(buf).metadata();
  await sharp(buf).toFile(args.output);

  console.log("Listo:", args.output);
  console.log(`  original : ${info.width}×${info.height}`);
  console.log(`  resultado: ${meta.width}×${meta.height}`);
  console.log(`  píxeles transparentes: ${((transparentes / px) * 100).toFixed(1)}%`);
  console.log("  Si quedó halo gris subí --min; si el logo quedó pálido bajá --max.");
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
