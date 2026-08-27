export const GENERATION_STATES = [
  "draft",
  "indexing",
  "reconciling",
  "ready",
  "active",
  "archived",
  "failed",
] as const;

export type GenerationState = (typeof GENERATION_STATES)[number];

export type GenerationRecord = {
  id: string;
  state: GenerationState;
};

export class GenerationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationTransitionError";
  }
}

const ALLOWED: Record<GenerationState, GenerationState[]> = {
  draft: ["indexing", "failed"],
  indexing: ["reconciling", "failed"],
  reconciling: ["ready", "failed"],
  ready: ["active", "failed"],
  active: ["archived"],
  archived: [],
  failed: [],
};

export function assertTransition(from: GenerationState, to: GenerationState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new GenerationTransitionError(`cannot transition generation from ${from} to ${to}`);
  }
}

export function promote(activeId: string | null, ready: GenerationRecord): { previousId: string | null; nextId: string } {
  if (ready.state !== "ready") {
    throw new GenerationTransitionError("only a ready generation can be promoted");
  }
  return { previousId: activeId, nextId: ready.id };
}

export function rollback(activeId: string, previous: GenerationRecord): string {
  if (previous.state !== "ready" && previous.state !== "active") {
    throw new GenerationTransitionError("rollback requires a retained ready or active generation");
  }
  if (previous.id === activeId) {
    throw new GenerationTransitionError("rollback target is already active");
  }
  return previous.id;
}

export function failGeneration(current: GenerationRecord, activeId: string | null): GenerationRecord {
  if (current.state === "active" || current.state === "archived") {
    throw new GenerationTransitionError("an active generation cannot fail in place");
  }
  if (current.id === activeId) {
    throw new GenerationTransitionError("a failed build must not change the active generation pointer");
  }
  assertTransition(current.state, "failed");
  return { ...current, state: "failed" };
}

export function canMarkReady(input: {
  auditStatus: "complete" | "partial" | "unsupported";
  auditClean: boolean;
  metadataIndexReady: boolean;
  dimensions: number;
  expectedDimensions: number;
}): void {
  if (input.auditStatus !== "complete" || !input.auditClean) {
    throw new GenerationTransitionError("partial or moving audits block promotion");
  }
  if (!input.metadataIndexReady) {
    throw new GenerationTransitionError("acl_group metadata index is not ready");
  }
  if (input.dimensions !== input.expectedDimensions) {
    throw new GenerationTransitionError("embedding dimensions do not match the generation");
  }
}

export const UPSERT_CHUNK_SQL = `INSERT INTO chunks (
  chunk_id, document_id, document_version_id, generation_id, heading, chunk_index,
  text, start_offset, end_offset, content_digest, vector_id, acl_group, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(chunk_id) DO UPDATE SET
  document_id = excluded.document_id,
  document_version_id = excluded.document_version_id,
  generation_id = excluded.generation_id,
  heading = excluded.heading,
  chunk_index = excluded.chunk_index,
  text = excluded.text,
  start_offset = excluded.start_offset,
  end_offset = excluded.end_offset,
  content_digest = excluded.content_digest,
  vector_id = excluded.vector_id,
  acl_group = excluded.acl_group`;

export const PROMOTE_SQL = `UPDATE corpus_state
SET active_generation_id = ?
WHERE singleton = 1
  AND ? IN (SELECT id FROM corpus_generations WHERE id = ? AND state = 'ready')`;
