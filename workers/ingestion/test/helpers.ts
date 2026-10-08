import { env } from "cloudflare:workers";

import type { VectorPort, VectorRecord } from "../../../src/lib/ingest/draft-index";
import { promoteGeneration, type SqlExecutor } from "../../../src/lib/store/corpus-d1";
import { seedNorthwindCorpus, type SeedDocumentInput } from "../../../src/lib/store/corpus-seed";

export const db = () => env.CORPUS_DB as unknown as SqlExecutor;

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type ZipSpec = {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  /** Overrides the size written in the headers, to build a lying archive. */
  declaredUncompressed?: number;
};

/** Minimal zip writer. The reader under test never checks CRCs, so they stay zero. */
export async function buildZip(entries: ZipSpec[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const payload = method === 8 ? await deflateRaw(entry.data) : entry.data;
    const uncompressed = entry.declaredUncompressed ?? entry.data.byteLength;
    const name = new TextEncoder().encode(entry.name);
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, payload.byteLength, true);
    lv.setUint32(22, uncompressed, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.byteLength);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(10, method, true);
    hv.setUint32(20, payload.byteLength, true);
    hv.setUint32(24, uncompressed, true);
    hv.setUint16(28, name.byteLength, true);
    hv.setUint32(42, offset, true);
    header.set(name, 46);
    parts.push(local, payload);
    central.push(header);
    offset += local.byteLength + payload.byteLength;
  }
  const directory = central.reduce((sum, item) => sum + item.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, item) => sum + item.byteLength, 0));
  let cursor = 0;
  for (const item of all) {
    out.set(item, cursor);
    cursor += item.byteLength;
  }
  return out;
}

export function documentXml(paragraphs: Array<string | { heading: number; text: string }>): string {
  const body = paragraphs
    .map((paragraph) =>
      typeof paragraph === "string"
        ? `<w:p><w:r><w:t xml:space="preserve">${paragraph}</w:t></w:r></w:p>`
        : `<w:p><w:pPr><w:pStyle w:val="Heading${paragraph.heading}"/></w:pPr><w:r><w:t>${paragraph.text}</w:t></w:r></w:p>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

export async function docxBytes(paragraphs: Parameters<typeof documentXml>[0]): Promise<Uint8Array> {
  return buildZip([
    { name: "[Content_Types].xml", data: new TextEncoder().encode("<Types/>") },
    { name: "word/document.xml", data: new TextEncoder().encode(documentXml(paragraphs)) },
  ]);
}

export const FAKE_DIMENSIONS = 1024;

/** Deterministic embeddings. Counts every document text it is asked to embed. */
export function fakeAi() {
  const embedded: string[] = [];
  return {
    embedded,
    run: async (_model: string, input: Record<string, unknown>) => {
      const documents = (input.documents as string[] | undefined) ?? [];
      embedded.push(...documents);
      return { data: documents.map((text) => vectorFor(text)) };
    },
  };
}

export function vectorFor(text: string): number[] {
  const seed = [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  return Array.from({ length: FAKE_DIMENSIONS }, (_, index) => ((seed + index) % 17) / 17);
}

/** In-memory Vectorize stand-in. `lag` holds describe() behind the newest mutation. */
export function fakeVectors(options: { lag?: boolean } = {}) {
  const store = new Map<string, VectorRecord>();
  const deleted: string[] = [];
  let counter = 0;
  let processed = "";
  let lag = options.lag ?? false;
  const port: VectorPort = {
    async upsert(vectors) {
      counter += 1;
      for (const vector of vectors) {
        store.set(vector.id, vector);
      }
      const mutationId = `m-${counter}`;
      if (!lag) {
        processed = mutationId;
      }
      return { mutationId };
    },
    async getByIds(ids) {
      return ids.flatMap((id) => {
        const found = store.get(id);
        return found ? [{ id, values: found.values, namespace: found.namespace, metadata: found.metadata }] : [];
      });
    },
    async deleteByIds(ids) {
      counter += 1;
      for (const id of ids) {
        store.delete(id);
        deleted.push(id);
      }
      const mutationId = `m-${counter}`;
      if (!lag) {
        processed = mutationId;
      }
      return { mutationId };
    },
    async describe() {
      return { processedUpToMutation: processed };
    },
  };
  return {
    port,
    store,
    deleted,
    catchUp: () => {
      lag = false;
      processed = `m-${counter}`;
    },
    /** Simulates a vector the index lost. */
    drop: (id: string) => store.delete(id),
  };
}

export const ACTIVE_DOCUMENTS: SeedDocumentInput[] = [
  {
    documentId: "base-handbook",
    title: "Employee Handbook",
    sourceName: "Employee Handbook",
    sourcePath: "northwind/hr/base-handbook.md",
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    body: "# Employee Handbook\n\n## Hours\n\nCore hours are ten to four.\n\n## Leave\n\nLeave is twenty five days.",
    metadata: { department: "hr", version: "1.0" },
  },
  {
    documentId: "base-salary",
    title: "Salary Bands",
    sourceName: "Salary Bands",
    sourcePath: "northwind/hr/base-salary.md",
    accessScope: "department",
    allowedRoles: [],
    allowedDepartments: ["hr"],
    body: "# Salary Bands\n\n## Bands\n\nBand four tops out at one hundred.",
    metadata: { department: "hr" },
  },
];

/** Seeds and promotes a small active generation. Keyword-only unless given a port. */
export async function seedActive(options: { ai?: ReturnType<typeof fakeAi>; vectors?: ReturnType<typeof fakeVectors> } = {}) {
  const result = await seedNorthwindCorpus({
    db: db(),
    documents: ACTIVE_DOCUMENTS,
    ai: options.ai,
    vectorize: options.vectors
      ? ({ upsert: options.vectors.port.upsert } as unknown as Parameters<typeof seedNorthwindCorpus>[0]["vectorize"])
      : undefined,
  });
  await promoteGeneration(db(), result.generationId);
  return result;
}

/** Clears pipeline tables between tests. Generations are left alone; ids are unique per test. */
export async function resetPipeline(): Promise<void> {
  await env.CORPUS_DB.batch([
    env.CORPUS_DB.prepare("DELETE FROM upload_files"),
    env.CORPUS_DB.prepare("DELETE FROM upload_batches"),
    env.CORPUS_DB.prepare("DELETE FROM draft_checks"),
    env.CORPUS_DB.prepare("DELETE FROM drafts"),
  ]);
}
