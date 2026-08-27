export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

export type GitHubTreePayload = {
  truncated?: unknown;
  tree?: unknown;
};

export function listGithubTextPaths(payload: GitHubTreePayload): string[] {
  if (payload.truncated === true) {
    throw new ConnectorError(
      "github tree response is truncated; refusing partial sync. Use a narrower path_prefix or a smaller repository.",
    );
  }
  if (!Array.isArray(payload.tree)) {
    throw new ConnectorError("github tree response missing tree[]");
  }
  const paths: string[] = [];
  for (const item of payload.tree) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as { type?: unknown; path?: unknown };
    if (record.type !== "blob" || typeof record.path !== "string") {
      continue;
    }
    const lower = record.path.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
      paths.push(record.path);
    }
  }
  return paths.sort();
}

export function staleDocumentIds(indexed: string[], listed: string[]): string[] {
  const keep = new Set(listed);
  return indexed.filter((id) => !keep.has(id)).sort();
}

export function canDeleteStale(input: { listComplete: boolean; ingestComplete: boolean }): boolean {
  return input.listComplete && input.ingestComplete;
}
