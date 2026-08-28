export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

export class SourceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceParseError";
  }
}

export type ParsedSource = {
  mime: string;
  text: string;
  byteSize: number;
};

export function sniffMime(filename: string, contentType = ""): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  if (lower.endsWith(".pdf") || contentType.includes("pdf")) {
    return "application/pdf";
  }
  throw new SourceParseError(`unsupported source format: ${filename}`);
}

export async function readBoundedBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        throw new SourceParseError(`source exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function parseSourceBytes(
  filename: string,
  bytes: Uint8Array,
  contentType = "",
): Promise<ParsedSource> {
  const mime = sniffMime(filename, contentType);
  if (bytes.byteLength === 0) {
    throw new SourceParseError("source is empty");
  }
  if (mime === "application/pdf") {
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new SourceParseError(`PDF exceeds ${MAX_PDF_BYTES} bytes`);
    }
    const text = await extractPdfText(bytes);
    if (!text.trim()) {
      throw new SourceParseError("PDF produced no extractable text");
    }
    return { mime, text, byteSize: bytes.byteLength };
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const text = mime === "text/html" ? htmlToText(decoded) : decoded;
  if (!text.trim()) {
    throw new SourceParseError("source is empty");
  }
  return { mime, text, byteSize: bytes.byteLength };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const mod = (await import("unpdf")) as {
    extractText?: (data: Uint8Array) => Promise<{ text: string | string[] } | string>;
    getDocumentProxy?: (data: Uint8Array) => Promise<unknown>;
  };
  if (typeof mod.extractText === "function") {
    const extracted = await mod.extractText(bytes);
    if (typeof extracted === "string") {
      return extracted;
    }
    if (extracted && typeof extracted === "object" && "text" in extracted) {
      return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    }
  }
  throw new SourceParseError("PDF parser is unavailable");
}
