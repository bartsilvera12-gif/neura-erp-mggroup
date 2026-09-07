/**
 * OCR vía Google Cloud Vision (API key). Solo servidor.
 */
export type VisionOcrResult = {
  fullText: string;
};

function esPdf(mimeType: string | null | undefined): boolean {
  return (mimeType ?? "").trim().toLowerCase().includes("pdf");
}

function textoDeRespuesta(first: Record<string, unknown> | undefined): string {
  const full =
    typeof first?.fullTextAnnotation === "object" && first.fullTextAnnotation !== null
      ? (first.fullTextAnnotation as { text?: string }).text
      : undefined;
  const text = typeof full === "string" ? full.trim() : "";
  if (text) return text;

  if (Array.isArray(first?.textAnnotations) && first.textAnnotations.length > 0) {
    const desc = (first.textAnnotations[0] as { description?: string })?.description;
    return typeof desc === "string" ? desc.trim() : "";
  }
  return "";
}

async function pedirAVision(
  key: string,
  endpoint: "images" | "files",
  body: unknown
): Promise<Record<string, unknown>> {
  const url = `https://vision.googleapis.com/v1/${endpoint}:annotate?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = raw.error as { message?: string } | undefined;
    throw new Error(errObj?.message ?? res.statusText ?? "Vision API error");
  }
  return raw;
}

/**
 * Texto de un comprobante.
 *
 * Los PDF van por `files:annotate` y las imágenes por `images:annotate`. Es una distinción
 * obligatoria, no una optimización: `images:annotate` rechaza un PDF por contenido inválido,
 * y como el OCR fallaba, el comprobante nunca se validaba y la boleta no se emitía. Los
 * clientes que descargan el comprobante del homebanking suelen mandar justamente un PDF.
 *
 * De un PDF se lee la primera página: un comprobante de transferencia no tiene más.
 */
export async function runGoogleVisionDocumentOcr(
  bytes: Buffer,
  mimeType?: string | null
): Promise<VisionOcrResult> {
  const key = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!key) {
    throw new Error("Falta GOOGLE_CLOUD_VISION_API_KEY en el entorno del servidor");
  }

  const b64 = bytes.toString("base64");

  if (esPdf(mimeType)) {
    const raw = await pedirAVision(key, "files", {
      requests: [
        {
          inputConfig: { content: b64, mimeType: "application/pdf" },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
          pages: [1],
        },
      ],
    });
    /** `files:annotate` anida una respuesta por página dentro de la respuesta del archivo. */
    const porArchivo = (raw.responses as unknown[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined;
    const porPagina = (porArchivo?.responses as unknown[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined;
    return { fullText: textoDeRespuesta(porPagina) };
  }

  const raw = await pedirAVision(key, "images", {
    requests: [
      {
        image: { content: b64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
      },
    ],
  });
  const first = (raw.responses as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
  return { fullText: textoDeRespuesta(first) };
}
