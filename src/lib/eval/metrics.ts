export function rankedDocumentIds(documentIds: Iterable<string>): string[] {
  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const documentId of documentIds) {
    if (seen.has(documentId)) {
      continue;
    }
    seen.add(documentId);
    ranked.push(documentId);
  }
  return ranked;
}

export function recall(ranked: string[], expected: Iterable<string>, requireAll = true): number {
  const wanted = new Set(expected);
  if (wanted.size === 0) {
    return 0;
  }
  const found = rankedDocumentIds(ranked).filter((id) => wanted.has(id));
  if (requireAll) {
    return found.length / wanted.size;
  }
  return found.length > 0 ? 1 : 0;
}

export function reciprocalRank(ranked: string[], expected: Iterable<string>): number {
  const wanted = new Set(expected);
  if (wanted.size === 0) {
    return 0;
  }
  for (const [index, documentId] of rankedDocumentIds(ranked).entries()) {
    if (wanted.has(documentId)) {
      return 1 / (index + 1);
    }
  }
  return 0;
}

export function ndcg(ranked: string[], expected: Iterable<string>, k: number, requireAll = true): number {
  if (k <= 0) {
    throw new Error(`ndcg needs a positive k, got ${k}`);
  }
  const wanted = new Set(expected);
  if (wanted.size === 0) {
    return 0;
  }
  const window = rankedDocumentIds(ranked).slice(0, k);
  if (!requireAll) {
    for (const [index, documentId] of window.entries()) {
      if (wanted.has(documentId)) {
        return 1 / Math.log2(index + 2);
      }
    }
    return 0;
  }
  const dcg = window.reduce((sum, documentId, index) => {
    return wanted.has(documentId) ? sum + 1 / Math.log2(index + 2) : sum;
  }, 0);
  const idealCount = Math.min(k, wanted.size);
  let ideal = 0;
  for (let position = 1; position <= idealCount; position += 1) {
    ideal += 1 / Math.log2(position + 1);
  }
  return ideal === 0 ? 0 : dcg / ideal;
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
