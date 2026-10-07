import { UploadFailure } from "./error-codes";

/** D8 budgets for the package-free DOCX extractor. */
export const DOCX_MAX_ENTRIES = 2_000;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const DOCX_MAX_RATIO = 10;
export const DOCX_TIME_BUDGET_MS = 10_000;
export const MAX_EXTRACTED_TEXT_BYTES = 1_000_000;
const MAX_PENDING_XML_CHARS = 4 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
const DOCUMENT_ENTRY = "word/document.xml";

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function corrupt(): never {
  throw new UploadFailure("CORRUPT_FILE");
}

function tooLarge(): never {
  throw new UploadFailure("ARCHIVE_TOO_LARGE");
}

/** Reads the central directory. Declared sizes are checked here, actual sizes while inflating. */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let index = bytes.byteLength - 22; index >= lowest; index -= 1) {
    if (view.getUint32(index, true) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) {
    return corrupt();
  }
  const total = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) {
    return tooLarge();
  }
  if (total > DOCX_MAX_ENTRIES) {
    return tooLarge();
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    return corrupt();
  }
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  let declaredTotal = 0;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      return corrupt();
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER) {
      return tooLarge();
    }
    if ((flags & 1) !== 0) {
      return corrupt();
    }
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > bytes.byteLength) {
      return corrupt();
    }
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, nameEnd));
    declaredTotal += uncompressedSize;
    if (declaredTotal > DOCX_MAX_UNCOMPRESSED_BYTES) {
      return tooLarge();
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (declaredTotal > DOCX_MAX_RATIO * bytes.byteLength) {
    return tooLarge();
  }
  return entries;
}

function entryBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localOffset;
  if (header + 30 > bytes.byteLength || view.getUint32(header, true) !== LOCAL_SIGNATURE) {
    return corrupt();
  }
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) {
    return corrupt();
  }
  return bytes.subarray(start, end);
}

/** Streams the entry through the inflater, aborting the moment output passes its declared size. */
async function* inflatedChunks(
  compressed: Uint8Array,
  entry: ZipEntry,
  deadline: number,
): AsyncGenerator<Uint8Array> {
  if (entry.method === 0) {
    yield compressed;
    return;
  }
  if (entry.method !== 8) {
    return corrupt();
  }
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(compressed));
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  let produced = 0;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        return corrupt();
      }
      if (result.done) {
        return;
      }
      produced += result.value.byteLength;
      if (produced > entry.uncompressedSize || produced > DOCX_MAX_UNCOMPRESSED_BYTES) {
        return tooLarge();
      }
      if (Date.now() > deadline) {
        throw new UploadFailure("TIMED_OUT");
      }
      yield result.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (match, body: string) => {
    if (body.startsWith("#x")) {
      return safeCodePoint(Number.parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith("#")) {
      return safeCodePoint(Number.parseInt(body.slice(1), 10), match);
    }
    return ENTITIES[body] ?? match;
  });
}

function safeCodePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback;
}

const RUN_TOKENS = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;

function paragraphText(xml: string): string {
  let text = "";
  for (const match of xml.matchAll(RUN_TOKENS)) {
    if (match[1] !== undefined) {
      text += decodeEntities(match[1]);
    } else if (match[0].startsWith("<w:tab")) {
      text += "\t";
    } else {
      text += "\n";
    }
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const style = xml.match(/<w:pStyle\s+w:val="(Title|Heading([1-6]))"/);
  if (style) {
    return `${"#".repeat(style[2] ? Number(style[2]) : 1)} ${trimmed}`;
  }
  return /<w:numPr>/.test(xml) ? `- ${trimmed}` : trimmed;
}

/** Text of word/document.xml, one blank line between paragraphs, headings as Markdown. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const deadline = Date.now() + DOCX_TIME_BUDGET_MS;
  const entries = readZipEntries(bytes);
  const entry = entries.find((candidate) => candidate.name === DOCUMENT_ENTRY);
  if (!entry) {
    return corrupt();
  }
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  const paragraphs: string[] = [];
  let textBytes = 0;
  let pending = "";
  const take = (paragraph: string) => {
    const text = paragraphText(paragraph);
    if (!text) {
      return;
    }
    textBytes += new TextEncoder().encode(text).byteLength + 2;
    if (textBytes > MAX_EXTRACTED_TEXT_BYTES) {
      throw new UploadFailure("TEXT_TOO_LARGE");
    }
    paragraphs.push(text);
  };
  for await (const chunk of inflatedChunks(entryBytes(bytes, entry), entry, deadline)) {
    pending += decoder.decode(chunk, { stream: true });
    for (let close = pending.indexOf("</w:p>"); close >= 0; close = pending.indexOf("</w:p>")) {
      take(pending.slice(0, close + 6));
      pending = pending.slice(close + 6);
    }
    if (pending.length > MAX_PENDING_XML_CHARS) {
      return corrupt();
    }
  }
  pending += decoder.decode();
  take(pending);
  return paragraphs.join("\n\n");
}
