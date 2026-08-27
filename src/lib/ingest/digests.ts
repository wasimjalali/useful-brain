export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function vectorIdForChunk(chunkId: string): Promise<string> {
  return (await sha256Hex(chunkId)).slice(0, 40);
}

export async function contentDigest(text: string): Promise<string> {
  return sha256Hex(text);
}

export async function generationNamespace(generationId: string): Promise<string> {
  return (await sha256Hex(generationId)).slice(0, 32);
}

export const VECTOR_ID_MAX_BYTES = 64;
export const ACL_GROUP_WIDTH = 32;
export const GENERATION_NAMESPACE_WIDTH = 32;
