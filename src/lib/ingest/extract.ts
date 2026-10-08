import { extractDocxText, MAX_EXTRACTED_TEXT_BYTES } from "./docx";
import { UploadFailure } from "./error-codes";
import { fileExtension, MAX_UPLOAD_BYTES } from "./upload-validation";

export type ExtractedUpload = { text: string; title: string };

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const mod = (await import("unpdf")) as {
    extractText?: (data: Uint8Array) => Promise<{ text: string | string[] } | string>;
  };
  if (typeof mod.extractText !== "function") {
    throw new UploadFailure("INTERNAL");
  }
  let extracted: { text: string | string[] } | string;
  try {
    extracted = await mod.extractText(new Uint8Array(bytes));
  } catch {
    throw new UploadFailure("CORRUPT_FILE");
  }
  const text = typeof extracted === "string" ? extracted : extracted.text;
  return Array.isArray(text) ? text.join("\n\n") : text;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new UploadFailure("CORRUPT_FILE");
  }
}

export function titleFor(fileName: string, text: string): string {
  const heading = text.slice(0, 4_000).match(/^#\s+(.+?)\s*$/m);
  if (heading?.[1]) {
    return heading[1].slice(0, 200);
  }
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).slice(0, 200);
}

/**
 * The only place upload bytes become text. Every failure is an UploadFailure
 * with a closed code, so the workflow records it without retrying.
 */
export async function extractUploadText(fileName: string, bytes: Uint8Array): Promise<ExtractedUpload> {
  const extension = fileExtension(fileName);
  if (!extension) {
    throw new UploadFailure("UNSUPPORTED_FORMAT");
  }
  if (bytes.byteLength === 0) {
    throw new UploadFailure("EMPTY_FILE");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadFailure("FILE_TOO_LARGE");
  }
  let raw: string;
  if (extension === "pdf") {
    raw = await extractPdfText(bytes);
  } else if (extension === "docx") {
    raw = await extractDocxText(bytes);
  } else {
    raw = decodeUtf8(bytes);
  }
  const text = raw
    .replace(/^﻿/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) {
    throw new UploadFailure(extension === "pdf" || extension === "docx" ? "NO_TEXT" : "EMPTY_FILE");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_EXTRACTED_TEXT_BYTES) {
    throw new UploadFailure("TEXT_TOO_LARGE");
  }
  return { text, title: titleFor(fileName, text) };
}
