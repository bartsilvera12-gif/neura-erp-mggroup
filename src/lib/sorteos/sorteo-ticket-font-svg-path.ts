import fs from "node:fs";
import path from "node:path";
import { create as fontkitCreate, type Font as FontkitFont } from "fontkit";

/**
 * Sharp usa librsvg: no aplica @font-face/CSS embebido; el texto sale como □.
 * Convertimos el texto a `<path d="…"/>`. **opentype.js** falla con Inter moderno
 * (`substFormat: 2 is not yet supported` en GSUB); **fontkit** sí maqueta bien.
 *
 * En Vercel/serverless, `node_modules/@fontsource/…` puede no ir en el bundle:
 * fuentes copiadas en `public/sorteos-ticket-fonts/` (desplegadas siempre).
 *
 * Uso app: `sorteo-ticket-text-path.ts` (server-only). Scripts QA importan este archivo.
 */
export type TicketPathWeight = 400 | 600 | 700 | 800;

/**
 * Familias del comprobante:
 *  - `sans` (Poppins): títulos, rótulos y nombres.
 *  - `mono` (Roboto Mono): números de cupón, documento, teléfono y orden. Los dígitos
 *    de ancho fijo alinean en columna y le dan la lectura de boleta impresa.
 *  - `inter`: la familia original, para no cambiar lo que ya dependía de ella.
 */
export type TicketFontFamily = "sans" | "mono" | "inter";

const FILES: Record<TicketFontFamily, { pkg: string; file: (w: TicketPathWeight) => string }> = {
  sans: { pkg: "poppins", file: (w) => `poppins-latin-${w}-normal.woff` },
  /** Roboto Mono no trae 600/800: se mapean al peso disponible más cercano. */
  mono: {
    pkg: "roboto-mono",
    file: (w) => `roboto-mono-latin-${w >= 700 ? 700 : w >= 600 ? 500 : 400}-normal.woff`,
  },
  inter: { pkg: "inter", file: (w) => `inter-latin-${w}-normal.woff` },
};

const fontCache = new Map<string, FontkitFont>();

function resolveWoff(family: TicketFontFamily, weight: TicketPathWeight): string {
  const { pkg, file } = FILES[family];
  const name = file(weight);
  const candidates = [
    path.join(process.cwd(), "public/sorteos-ticket-fonts", name),
    path.join(process.cwd(), `node_modules/@fontsource/${pkg}/files`, name),
  ];
  for (const fp of candidates) {
    if (fs.existsSync(fp)) return fp;
  }
  throw new Error(
    `WOFF no encontrado (${name}). Probado:\n${candidates.map((p) => ` - ${p}`).join("\n")}`
  );
}

export function normalizeTicketFontWeight(w: number): TicketPathWeight {
  if (w <= 450) return 400;
  if (w <= 650) return 600;
  if (w <= 750) return 700;
  return 800;
}

export function getSorteoTicketFont(weight: number, family: TicketFontFamily = "sans"): FontkitFont {
  const w = normalizeTicketFontWeight(weight);
  const key = `${family}:${w}`;
  const cached = fontCache.get(key);
  if (cached) return cached;
  const raw = fontkitCreate(fs.readFileSync(resolveWoff(family, w)));
  const font = raw as FontkitFont;
  fontCache.set(key, font);
  return font;
}

/** Compatibilidad con los scripts de QA que ya pedían Inter por nombre. */
export function getSorteoInterFont(weight: number): FontkitFont {
  return getSorteoTicketFont(weight, "inter");
}

/** Ancho del texto en px. Necesario para truncar y para centrar bloques sin que se pisen. */
export function measureTicketTextWidth(
  text: string,
  fontSize: number,
  weight: number,
  family: TicketFontFamily = "sans"
): number {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return 0;
  try {
    const font = getSorteoTicketFont(weight, family);
    const run = font.layout(t);
    let adv = 0;
    for (const pos of run.positions) adv += pos.xAdvance;
    return (adv * fontSize) / font.unitsPerEm;
  } catch {
    /** Sin fuente disponible, aproximación conservadora. */
    return t.length * fontSize * 0.6;
  }
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Devuelve `<path …/>` o cadena vacía. `y` = línea base (como `<text y>` en SVG).
 */
export function svgTextAsPath(opts: {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  weight: number;
  fill: string;
  textAnchor?: "start" | "middle";
  family?: TicketFontFamily;
}): string {
  const t = opts.text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  try {
    const font = getSorteoTicketFont(opts.weight, opts.family ?? "sans");
    const fontSize = opts.fontSize;
    const scale = fontSize / font.unitsPerEm;
    const run = font.layout(t);

    let totalAdv = 0;
    for (const pos of run.positions) {
      totalAdv += pos.xAdvance;
    }

    let startX = opts.x;
    if (opts.textAnchor === "middle") {
      startX = opts.x - (totalAdv * scale) / 2;
    }

    let xPen = 0;
    const dParts: string[] = [];
    for (let i = 0; i < run.glyphs.length; i++) {
      const glyph = run.glyphs[i]!;
      const pos = run.positions[i]!;
      const fragment = glyph.path
        .translate(xPen + pos.xOffset, pos.yOffset)
        .transform(scale, 0, 0, -scale, startX, opts.y)
        .toSVG();
      if (fragment) dParts.push(fragment);
      xPen += pos.xAdvance;
    }

    const dCombined = dParts.join(" ");
    if (!dCombined.trim()) return "";

    const dEsc = dCombined.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    return `<path fill="${escAttr(opts.fill)}" d="${dEsc}"/>`;
  } catch (e) {
    console.error("[sorteo-ticket] text_path_failed", {
      message: e instanceof Error ? e.message : String(e),
      preview: t.slice(0, 80),
    });
    return "";
  }
}
