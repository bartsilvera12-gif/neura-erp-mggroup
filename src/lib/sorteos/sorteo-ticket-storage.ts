import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const SORTEO_TICKET_ASSETS_BUCKET = "sorteo-ticket-assets";
export const SORTEO_TICKET_GENERATED_BUCKET = "sorteo-tickets-generated";

export function sorteoTicketAssetLogoPath(empresaId: string, sorteoId: string): string {
  return `${empresaId}/${sorteoId}/logo.png`;
}

export function sorteoTicketAssetBackgroundPath(empresaId: string, sorteoId: string): string {
  return `${empresaId}/${sorteoId}/background.png`;
}

/** Plantilla base completa (PNG/JPG/WebP subidos como template.*). */
export function sorteoTicketAssetTemplatePath(empresaId: string, sorteoId: string): string {
  return `${empresaId}/${sorteoId}/template.png`;
}

/** Posibles paths en Storage para logo (upload puede usar .png / .webp / .jpg). */
export function sorteoTicketAssetLogoCandidates(empresaId: string, sorteoId: string): string[] {
  const base = `${empresaId}/${sorteoId}`;
  return [`${base}/logo.png`, `${base}/logo.webp`, `${base}/logo.jpg`];
}

/** URL publica de un archivo del bucket de assets. El bucket se crea con `public: true`. */
export function sorteoTicketAssetPublicUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${SORTEO_TICKET_ASSETS_BUCKET}/${path}`;
}

/**
 * URL publica del logo del sorteo, o `null` si no subieron ninguno.
 *
 * La boleta impresa tenia su propio campo de logo, una URL escrita a mano en Configuracion →
 * Ticket, separada del logo que se sube para el sorteo. Nadie la llenaba —es razonable pensar
 * que subir el logo una vez alcanza— y la boleta salia sin logo mientras la de WhatsApp lo
 * mostraba bien. Esto la deja caer al logo del sorteo cuando el campo esta vacio.
 *
 * Se prueban las tres extensiones con `HEAD`, sin bajar el archivo: solo interesa cual existe,
 * porque la imagen la termina pidiendo el navegador que imprime.
 */
export async function sorteoLogoPublicUrl(
  empresaId: string,
  sorteoId: string
): Promise<string | null> {
  if (!empresaId || !sorteoId) return null;
  for (const path of sorteoTicketAssetLogoCandidates(empresaId, sorteoId)) {
    const url = sorteoTicketAssetPublicUrl(path);
    if (!url) return null;
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return url;
    } catch {
      /** Sin red o storage caido: la boleta sale sin logo, que es como sale hoy. */
      return null;
    }
  }
  return null;
}

/** Posibles paths en Storage para fondo del ticket. */
export function sorteoTicketAssetBackgroundCandidates(empresaId: string, sorteoId: string): string[] {
  const base = `${empresaId}/${sorteoId}`;
  return [`${base}/background.png`, `${base}/background.webp`, `${base}/background.jpg`];
}

export function sorteoTicketAssetTemplateCandidates(empresaId: string, sorteoId: string): string[] {
  const base = `${empresaId}/${sorteoId}`;
  return [`${base}/template.png`, `${base}/template.webp`, `${base}/template.jpg`];
}

export function sorteoTicketGeneratedPath(
  empresaId: string,
  sorteoId: string,
  entradaId: string,
  templateRevision: number
): string {
  return `${empresaId}/${sorteoId}/${entradaId}/${templateRevision}.png`;
}

export async function ensureTicketBucketsExist(supabase: AppSupabaseClient): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const names = new Set((buckets ?? []).map((b) => b.name));
  if (!names.has(SORTEO_TICKET_ASSETS_BUCKET)) {
    const { error } = await supabase.storage.createBucket(SORTEO_TICKET_ASSETS_BUCKET, {
      public: true,
      fileSizeLimit: 5242880,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (error && !error.message.toLowerCase().includes("already exists")) {
      console.warn("[sorteo-ticket-storage] bucket_assets", { message: error.message });
    }
  }
  if (!names.has(SORTEO_TICKET_GENERATED_BUCKET)) {
    const { error } = await supabase.storage.createBucket(SORTEO_TICKET_GENERATED_BUCKET, {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ["image/png"],
    });
    if (error && !error.message.toLowerCase().includes("already exists")) {
      console.warn("[sorteo-ticket-storage] bucket_generated", { message: error.message });
    }
  }
}

export async function downloadAssetIfExists(
  supabase: AppSupabaseClient,
  bucket: string,
  path: string
): Promise<{ bytes: Buffer; mime: string } | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  const ab = await data.arrayBuffer();
  const bytes = Buffer.from(ab);
  const mime =
    path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { bytes, mime };
}

export async function uploadGeneratedTicketPng(
  supabase: AppSupabaseClient,
  path: string,
  png: Buffer
): Promise<{ error?: string }> {
  const { error } = await supabase.storage
    .from(SORTEO_TICKET_GENERATED_BUCKET)
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (error) return { error: error.message };
  return {};
}

export async function createSignedUrlForTicket(
  supabase: AppSupabaseClient,
  path: string,
  expiresSec: number
): Promise<{ url: string | null; error?: string }> {
  const { data, error } = await supabase.storage
    .from(SORTEO_TICKET_GENERATED_BUCKET)
    .createSignedUrl(path, expiresSec);
  if (error || !data?.signedUrl) {
    return { url: null, error: error?.message ?? "signed_url_failed" };
  }
  return { url: data.signedUrl };
}
