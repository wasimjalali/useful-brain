export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// D1 stores one document body per row and caps rows at 2 MB. A 10 MB upload
// of plain text cannot become one knowledge document, so text is capped below
// that with a clear message instead of an opaque seed failure.
export const MAX_DOCUMENT_TEXT_CHARS = 1_500_000;

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export async function extractUploadedText(
  file: File,
): Promise<{ title: string; markdown: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("That file is too large. Keep uploads under 10 MB.");
  }

  const extension = getExtension(file.name);
  const title = deriveTitle(file.name);

  let markdown: string;

  if (TEXT_EXTENSIONS.has(extension)) {
    markdown = await file.text();
  } else if (extension === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    markdown = text;
  } else {
    throw new Error(
      "Unsupported file type. Upload a .md, .markdown, .txt, or .pdf file.",
    );
  }

  if (!markdown.trim()) {
    throw new Error("That file did not contain any readable text.");
  }

  if (markdown.length > MAX_DOCUMENT_TEXT_CHARS) {
    throw new Error(
      "That file extracts to more text than one knowledge document can hold (about 1.5 million characters). Split it into parts and upload each part.",
    );
  }

  return { title, markdown };
}

function getExtension(fileName: string) {
  const match = /\.[^.]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : "";
}

function deriveTitle(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}
