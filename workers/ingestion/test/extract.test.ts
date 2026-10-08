import { describe, expect, it } from "vitest";

import { DOCX_MAX_ENTRIES, extractDocxText, MAX_EXTRACTED_TEXT_BYTES } from "../../../src/lib/ingest/docx";
import { UploadFailure } from "../../../src/lib/ingest/error-codes";
import { extractUploadText } from "../../../src/lib/ingest/extract";
import { buildZip, docxBytes } from "./helpers";

const enc = (text: string) => new TextEncoder().encode(text);

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof UploadFailure) {
      return error.code;
    }
    throw error;
  }
  return "none";
}

describe("upload text extraction failures", () => {
  it("rejects a docx zip bomb on its declared ratio before inflating", async () => {
    const bomb = await buildZip([
      { name: "word/document.xml", data: new Uint8Array(30 * 1024 * 1024) },
    ]);
    expect(bomb.byteLength).toBeLessThan(200_000);
    expect(await failureOf(() => extractDocxText(bomb))).toBe("ARCHIVE_TOO_LARGE");
  });

  it("aborts a docx whose header lies about the uncompressed size", async () => {
    const lying = await buildZip([
      {
        name: "word/document.xml",
        data: new Uint8Array(4 * 1024 * 1024).fill(32),
        declaredUncompressed: 2_000,
      },
    ]);
    expect(await failureOf(() => extractDocxText(lying))).toBe("ARCHIVE_TOO_LARGE");
  });

  it("rejects a docx with too many entries", async () => {
    const entries = Array.from({ length: DOCX_MAX_ENTRIES + 1 }, (_, index) => ({
      name: `f${index}.txt`,
      data: enc("x"),
      method: 0 as const,
    }));
    expect(await failureOf(async () => extractDocxText(await buildZip(entries)))).toBe("ARCHIVE_TOO_LARGE");
  });

  it("rejects bytes that are not a zip and a zip without word/document.xml", async () => {
    expect(await failureOf(() => extractDocxText(enc("not a zip at all, just text")))).toBe("CORRUPT_FILE");
    const wrong = await buildZip([{ name: "other.xml", data: enc("<a/>") }]);
    expect(await failureOf(() => extractDocxText(wrong))).toBe("CORRUPT_FILE");
  });

  it("rejects text above one million UTF-8 bytes", async () => {
    const big = "word ".repeat(MAX_EXTRACTED_TEXT_BYTES / 4);
    expect(await failureOf(() => extractUploadText("big.md", enc(big)))).toBe("TEXT_TOO_LARGE");
    // Varied text so the archive stays under the 10x ratio cap and the size cap is what trips.
    const noise = (length: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) =>
        String.fromCharCode(97 + (byte % 26)),
      ).join("");
    const paragraphs = Array.from({ length: 400 }, () => noise(3_000));
    expect(await failureOf(async () => extractUploadText("big.docx", await docxBytes(paragraphs)))).toBe(
      "TEXT_TOO_LARGE",
    );
  });

  it("maps empty, invalid UTF-8 and unsupported files to closed codes", async () => {
    expect(await failureOf(() => extractUploadText("a.md", new Uint8Array()))).toBe("EMPTY_FILE");
    expect(await failureOf(() => extractUploadText("a.md", enc("   \n\n  ")))).toBe("EMPTY_FILE");
    expect(await failureOf(() => extractUploadText("a.txt", new Uint8Array([0xff, 0xfe, 0xfd])))).toBe(
      "CORRUPT_FILE",
    );
    expect(await failureOf(() => extractUploadText("a.exe", enc("x")))).toBe("UNSUPPORTED_FORMAT");
    expect(await failureOf(() => extractUploadText("a.pdf", enc("this is not a pdf")))).toBe("CORRUPT_FILE");
  });
});

function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 20 50 Td (${text}) Tj ET`;
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R/Size 6>>",
    "%%EOF",
  ].join("\n");
  return enc(body);
}

describe("upload text extraction", () => {
  it("reads the text layer of a pdf", async () => {
    const extracted = await extractUploadText("Policy.pdf", tinyPdf("Hello draft pipeline"));
    expect(extracted.text).toContain("Hello draft pipeline");
    expect(extracted.title).toBe("Policy");
  });

  it("reads headings, paragraphs and entities from a docx", async () => {
    const bytes = await docxBytes([
      { heading: 1, text: "Parental Leave" },
      "Eligible staff get 16 weeks &amp; full pay.",
      { heading: 2, text: "How to apply" },
      "Email HR before the fifth.",
    ]);
    const extracted = await extractUploadText("Parental Leave.docx", bytes);
    expect(extracted.title).toBe("Parental Leave");
    expect(extracted.text).toBe(
      "# Parental Leave\n\nEligible staff get 16 weeks & full pay.\n\n## How to apply\n\nEmail HR before the fifth.",
    );
  });

  it("uses the first heading as the title for markdown, else the file name", async () => {
    expect((await extractUploadText("x.md", enc("# Real Title\n\nbody"))).title).toBe("Real Title");
    expect((await extractUploadText("Plain Notes.txt", enc("just words"))).title).toBe("Plain Notes");
  });

  it("strips a BOM and normalizes line endings", async () => {
    const extracted = await extractUploadText("a.md", enc("﻿# T\r\n\r\nbody"));
    expect(extracted.text).toBe("# T\n\nbody");
  });
});
