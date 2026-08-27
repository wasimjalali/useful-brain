const TOKEN_RE = /[a-z0-9_]+/gi;

export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vec;
  }
  return vec.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

export class FakeEmbeddingProvider {
  readonly providerName = "fake";
  readonly modelName = "sanad-fake-embed";

  constructor(readonly dimensions = 64) {}

  embedTexts(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedOne(text)));
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  private async embedOne(text: string): Promise<number[]> {
    const vec = Array.from({ length: this.dimensions }, () => 0);
    const tokens = text.toLowerCase().match(TOKEN_RE) ?? [];
    if (tokens.length === 0) {
      return vec;
    }
    const encoder = new TextEncoder();
    for (const token of tokens) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
      const idx = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0) % this.dimensions;
      vec[idx] += digest[4] % 2 === 0 ? 1 : -1;
    }
    return l2Normalize(vec);
  }
}
