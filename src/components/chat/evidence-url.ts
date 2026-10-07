import type { EvidenceTab } from "@/lib/contracts/chat-view";

/** Evidence panel state carried in the URL: ?evidence=cited|retrieved&doc=<id>&c=<n>. */
export type EvidenceUrlState = {
  evidence: EvidenceTab | null;
  doc: string | null;
  c: number | null;
};

const KEYS = ["evidence", "doc", "c"] as const;
const MAX_DOC_ID = 200;

export function parseEvidenceUrl(params: URLSearchParams): EvidenceUrlState {
  const evidence = params.get("evidence");
  const doc = params.get("doc");
  const c = Number(params.get("c"));
  return {
    evidence: evidence === "cited" || evidence === "retrieved" ? evidence : null,
    doc: doc && doc.length <= MAX_DOC_ID ? doc : null,
    c: Number.isInteger(c) && c > 0 ? c : null,
  };
}

/** Returns the query string (no leading "?") with our keys set or removed and every other param kept. */
export function applyEvidenceUrl(search: string, state: EvidenceUrlState): string {
  const params = new URLSearchParams(search);
  for (const key of KEYS) {
    params.delete(key);
  }
  if (state.evidence) params.set("evidence", state.evidence);
  if (state.doc) params.set("doc", state.doc);
  if (state.c !== null) params.set("c", String(state.c));
  return params.toString();
}
