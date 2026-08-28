import { describe, expect, it } from "vitest";

import {
  CHUNKING_VERSION,
  SHIPPED_MAX_TOKENS,
  SHIPPED_OVERLAP_TOKENS,
  chunkDocument,
  splitTokens,
} from "./chunker";
import { countTokens, pretokenSpans } from "./tokenizer";

function doc(content: string, documentId = "refund") {
  return { documentId, content };
}

describe("300/30 chunker", () => {
  it("ships the measured Burooj profile, not the library 500/50 default", () => {
    expect(SHIPPED_MAX_TOKENS).toBe(300);
    expect(SHIPPED_OVERLAP_TOKENS).toBe(30);
    expect(CHUNKING_VERSION).toBe("300-30-v1");
  });

  it("splits on headings and never spans two headings", () => {
    const body = Array.from({ length: 400 }, (_, i) => `alpha${i}`).join(" ");
    const other = Array.from({ length: 400 }, (_, i) => `beta${i}`).join(" ");
    const chunks = chunkDocument(doc(`## Germany\n\n${body}\n\n## US\n\n${other}\n`), {
      maxTokens: 120,
      overlapTokens: 12,
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      const hasAlpha = chunk.content.includes("alpha");
      const hasBeta = chunk.content.includes("beta");
      expect(hasAlpha && hasBeta).toBe(false);
      expect(chunk.sectionHeading).toBe(hasAlpha ? "Germany" : "US");
    }
  });

  it("respects the token budget", () => {
    const body = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkDocument(doc(`## Body\n\n${body}\n`), {
      maxTokens: 200,
      overlapTokens: 20,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(countTokens(chunk.content)).toBeLessThanOrEqual(200 * 1.05);
    }
  });

  it("overlaps consecutive chunks in one section and honours zero overlap", () => {
    const body = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(" ");
    const overlapped = chunkDocument(doc(`## Body\n\n${body}\n`), {
      maxTokens: 150,
      overlapTokens: 30,
    });
    expect(overlapped.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < overlapped.length - 1; i += 1) {
      const earlier = overlapped[i];
      const later = overlapped[i + 1];
      if (earlier.sectionHeading !== later.sectionHeading) {
        continue;
      }
      const tail = new Set(earlier.content.split(" ").slice(-40));
      const head = new Set(later.content.split(" ").slice(0, 40));
      expect([...tail].some((word) => head.has(word))).toBe(true);
    }

    const zero = chunkDocument(doc(`## Body\n\n${Array.from({ length: 800 }, (_, i) => `word${i}`).join(" ")}\n`), {
      maxTokens: 100,
      overlapTokens: 0,
    });
    const seen = new Set<string>();
    for (const chunk of zero) {
      const words = chunk.content.split(" ");
      expect(words.some((word) => seen.has(word))).toBe(false);
      for (const word of words) {
        seen.add(word);
      }
    }
  });

  it("uses dense ordered indices, is deterministic, and drops empty sections", () => {
    const content = `## A\n\n${Array.from({ length: 600 }, (_, i) => `x${i}`).join(" ")}\n\n## B\n\nshort tail.\n`;
    const first = chunkDocument(doc(content), { maxTokens: 100, overlapTokens: 10 });
    const second = chunkDocument(doc(content), { maxTokens: 100, overlapTokens: 10 });
    expect(first.map((chunk) => chunk.chunkIndex)).toEqual([...Array(first.length).keys()]);
    expect(new Set(first.map((chunk) => chunk.chunkId)).size).toBe(first.length);
    expect(first.map((chunk) => chunk.chunkId)).toEqual(second.map((chunk) => chunk.chunkId));
    expect(chunkDocument(doc("## Empty\n\n\n\n## Real\n\nActual content here.\n")).map((c) => c.sectionHeading)).toEqual([
      "Real",
    ]);
  });

  it("keeps a short section as one chunk and refuses overlap at the window size", () => {
    const chunks = chunkDocument(doc("## Germany\n\nRF-75 within 48 hours.\n"));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("RF-75 within 48 hours.");
    expect(() => chunkDocument(doc("## A\n\nbody"), { maxTokens: 100, overlapTokens: 100 })).toThrow(/overlap/);
  });

  it("covers every character with pretokens, including underscores", () => {
    const samples = [
      "___",
      "_Effective 2026-01-01._",
      "a__b",
      "snake_case_name and __dunder__",
      "café ☕ 日本語 🚀 שלום",
    ];
    for (const text of samples) {
      const spans = pretokenSpans(text);
      expect(spans.map(([start, end]) => text.slice(start, end)).join("")).toBe(text);
      for (let i = 0; i < spans.length - 1; i += 1) {
        expect(spans[i][1]).toBe(spans[i + 1][0]);
      }
    }
    const headings = chunkDocument(doc("## Divider\n\n___\n\n## Real\n\nContent here.\n")).map(
      (chunk) => chunk.sectionHeading,
    );
    expect(headings).toContain("Divider");
    expect(chunkDocument(doc("## A\n\n_Effective 2026-01-01._ Applies to all.\n"))[0].content.startsWith("_Effective")).toBe(
      true,
    );
  });

  it("does not split decimals and still prefers sentence ends", () => {
    const decimals = Array.from({ length: 59 }, (_, i) => `Q${i + 1} | ${i + 1}.${i + 1} | on target`).join(" | ");
    for (const maxTokens of [40, 80, 150]) {
      for (const part of splitTokens(decimals, { maxTokens, overlapTokens: 0 })) {
        expect(part.trimEnd().endsWith(".")).toBe(false);
      }
    }
    const sentences = "Refunds close after thirty days. ".repeat(60).trim();
    const parts = splitTokens(sentences, { maxTokens: 60, overlapTokens: 0 });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(0, -1).filter((part) => part.trimEnd().endsWith(".")).length).toBeGreaterThanOrEqual(
      parts.length - 2,
    );
  });

  it("bounds an oversized pretoken without losing characters", () => {
    const logo = `![logo](data:image/png;base64,${"A".repeat(40000)})`;
    const parts = splitTokens(logo, { maxTokens: 500, overlapTokens: 50 });
    expect(Math.max(...parts.map((part) => part.length))).toBeLessThanOrEqual(500 * 6 * 1.1);
    expect(splitTokens("B".repeat(9000), { maxTokens: 100, overlapTokens: 0 }).join("")).toBe("B".repeat(9000));
  });

  it("anchors chunks in the original document", () => {
    const content =
      "# Title\n\n## Germany\n\nRF-75 within 48 hours for renewed subscriptions.\n\n## US\n\nStandard 30 day refund window.\n";
    const chunks = chunkDocument(doc(content, "policy"));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(content.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.content);
    }
  });
});
