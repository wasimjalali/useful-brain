import { describe, expect, it } from "vitest";

import { MAX_SOURCE_BYTES, parseSourceBytes, readBoundedBytes, sniffMime } from "./parsers";

describe("source parsers", () => {
  it("accepts markdown, text and HTML as UTF-8 and rejects empty or unknown types", async () => {
    expect(sniffMime("policy.md")).toBe("text/markdown");
    expect((await parseSourceBytes("note.txt", new TextEncoder().encode("hello"))).text).toBe("hello");
    const html = await parseSourceBytes("page.html", new TextEncoder().encode("<p>hi</p>"));
    expect(html.mime).toBe("text/html");
    expect(html.text).toBe("hi");
    await expect(parseSourceBytes("note.txt", new Uint8Array())).rejects.toThrow(/empty/);
    expect(() => sniffMime("notes.exe")).toThrow(/unsupported/);
  });

  it("bounds a streamed object under the Worker memory envelope", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16));
        controller.enqueue(new Uint8Array(16));
        controller.close();
      },
    });
    expect((await readBoundedBytes(stream, 64)).byteLength).toBe(32);
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SOURCE_BYTES + 1));
        controller.close();
      },
    });
    await expect(readBoundedBytes(oversized, MAX_SOURCE_BYTES)).rejects.toThrow(/exceeds/);
  });
});
