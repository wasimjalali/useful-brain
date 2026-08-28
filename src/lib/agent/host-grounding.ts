import {
  INSUFFICIENT_EVIDENCE_ANSWER,
  textSupportedByPassages,
} from "../answer/contract";

export const SEARCH_KNOWLEDGE_TOOL = "search_knowledge";

export const BRAIN_NOT_ENOUGH_EVIDENCE = INSUFFICIENT_EVIDENCE_ANSWER;
export const BRAIN_KNOWLEDGE_UNAVAILABLE =
  "The knowledge base is unavailable. Try the question again in a new turn.";
export const BRAIN_MUST_RETRIEVE =
  "Answers must be grounded in retrieved evidence. No retrieval ran for this turn, so no answer can be given.";
export const BRAIN_INVALID_CITATION =
  "A citation in the draft answer did not match evidence retrieved in this turn, so the answer was refused.";

const MARKER_RE = /\[(\d{1,2})\]|〔(\d{1,2})〕/g;
const HOST_STRINGS = new Set([
  BRAIN_NOT_ENOUGH_EVIDENCE,
  BRAIN_KNOWLEDGE_UNAVAILABLE,
  BRAIN_MUST_RETRIEVE,
  BRAIN_INVALID_CITATION,
]);

const SYNTHETIC_USER_FLAGS = [
  "_dropped_toolcall_nudge",
  "_verification_stop_synthetic",
  "_pre_verify_synthetic",
  "_kanban_stop_synthetic",
  "_empty_recovery_synthetic",
] as const;

export type BrainAgent = {
  profile?: string;
  validToolNames?: Iterable<string>;
};

export type TranscriptMessage = {
  role?: string;
  name?: string;
  tool_name?: string;
  content?: unknown;
  [key: string]: unknown;
};

export type EvidenceIdentity = {
  chunkId: string;
  documentId: string;
  version: string | null;
  section: string;
  text: string;
  source?: string;
};

export type TurnEvidenceLedger = {
  identities: EvidenceIdentity[];
  byChunkId: Map<string, EvidenceIdentity>;
  byLabel: Map<number, EvidenceIdentity>;
  successfulSearchCount: number;
  emptyOrInsufficient: boolean;
  searchError: boolean;
  labelConflict: boolean;
};

export function createLedger(): TurnEvidenceLedger {
  return {
    identities: [],
    byChunkId: new Map(),
    byLabel: new Map(),
    successfulSearchCount: 0,
    emptyOrInsufficient: false,
    searchError: false,
    labelConflict: false,
  };
}

export function isBrainProfile(agent: BrainAgent): boolean {
  const profile = agent.profile?.trim().toLowerCase() ?? "brain";
  return profile === "brain";
}

export function knowledgeToolsPresent(agent: BrainAgent): boolean {
  const names = new Set(agent.validToolNames ?? []);
  return names.has(SEARCH_KNOWLEDGE_TOOL);
}

export function citedMarkerIndexes(text: string): number[] {
  if (!text) {
    return [];
  }
  const out: number[] = [];
  const matcher = new RegExp(MARKER_RE.source, "g");
  for (const match of text.matchAll(matcher)) {
    const raw = match[1] ?? match[2];
    const n = Number.parseInt(raw ?? "", 10);
    if (Number.isInteger(n) && n >= 1) {
      out.push(n);
    }
  }
  return out;
}

export function markersValidForLedger(text: string, ledger: TurnEvidenceLedger): boolean {
  if (!text) {
    return true;
  }
  if (ledger.labelConflict) {
    return false;
  }
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .every((paragraph) => {
      const markers = citedMarkerIndexes(paragraph);
      if (markers.length === 0) {
        return false;
      }
      const cited = [...new Set(markers)].map((marker) => ledger.byLabel.get(marker));
      if (cited.some((item) => !item)) {
        return false;
      }
      return textSupportedByPassages(
        paragraph.replace(MARKER_RE, "").trim(),
        cited.flatMap((item) => [item?.section ?? "", item?.text ?? ""]),
      );
    });
}

export function appendSearchHit(ledger: TurnEvidenceLedger, identity: EvidenceIdentity): string {
  const label = addIdentity(ledger, identity);
  if (label === null) {
    throw new Error("evidence identity was not recorded");
  }
  return `[${label}]`;
}

export function ingestSearchPayload(ledger: TurnEvidenceLedger, payload: unknown): void {
  if (!isRecord(payload)) {
    return;
  }
  if (payload.error) {
    ledger.searchError = true;
    return;
  }

  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  const notEnough = Boolean(payload.not_enough_evidence);

  ledger.successfulSearchCount += 1;
  const before = ledger.identities.length;

  for (const hit of hits) {
    const identity = identityFromHit(hit);
    if (identity) {
      addIdentity(ledger, identity, hitLabel(hit));
    }
  }
  for (const citation of citations) {
    const identity = identityFromCitation(citation);
    if (identity) {
      addIdentity(ledger, identity, hitLabel(citation));
    }
  }

  const added = ledger.identities.length - before;
  if (notEnough || (added === 0 && hits.length === 0 && citations.length === 0)) {
    if (ledger.identities.length === 0) {
      ledger.emptyOrInsufficient = true;
    }
  } else if (ledger.identities.length > 0) {
    ledger.emptyOrInsufficient = false;
  }
}

export function buildTurnLedger(messages: Iterable<TranscriptMessage>): TurnEvidenceLedger {
  const ledger = createLedger();
  const turnPayloads: unknown[] = [];
  for (const msg of [...messages].reverse()) {
    const role = msg.role;
    if (role === "user") {
      if (isSyntheticUserMessage(msg)) {
        continue;
      }
      break;
    }
    if (role !== "tool") {
      continue;
    }
    const name = msg.name || msg.tool_name || "";
    if (name !== SEARCH_KNOWLEDGE_TOOL) {
      continue;
    }
    turnPayloads.push(parseToolPayload(msg.content));
  }
  for (const payload of turnPayloads.reverse()) {
    ingestSearchPayload(ledger, payload);
  }
  return ledger;
}

export function rewriteAssistantTranscript(
  messages: TranscriptMessage[],
  grounded: string,
  previous: string | null,
): void {
  if (messages.length === 0 || grounded === previous) {
    return;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg.role !== "assistant") {
      if (msg.role === "user" && !isSyntheticUserMessage(msg)) {
        break;
      }
      continue;
    }
    const content = msg.content;
    if (previous !== null && content === previous) {
      msg.content = grounded;
      return;
    }
    if (content && String(content).trim() && content !== grounded) {
      msg.content = grounded;
      return;
    }
  }
  messages.push({ role: "assistant", content: grounded });
}

export function enforceBrainGrounding(
  agent: BrainAgent,
  input: {
    finalResponse: string | null | undefined;
    messages: TranscriptMessage[];
    interrupted?: boolean;
    failed?: boolean;
    rewriteTranscript?: boolean;
  },
): string | null | undefined {
  if (!isBrainProfile(agent)) {
    return input.finalResponse;
  }
  if (!isAnswerBearing(input.finalResponse, input.interrupted === true, input.failed === true)) {
    return input.finalResponse;
  }

  const previous = input.finalResponse ?? null;
  let grounded: string;
  if (!knowledgeToolsPresent(agent)) {
    grounded = BRAIN_KNOWLEDGE_UNAVAILABLE;
  } else {
    const ledger = buildTurnLedger(input.messages);
    if (ledger.successfulSearchCount === 0) {
      grounded = ledger.searchError ? BRAIN_KNOWLEDGE_UNAVAILABLE : BRAIN_MUST_RETRIEVE;
    } else if (ledger.identities.length === 0 || ledger.emptyOrInsufficient) {
      grounded = BRAIN_NOT_ENOUGH_EVIDENCE;
    } else if (!markersValidForLedger(String(input.finalResponse), ledger)) {
      grounded = BRAIN_INVALID_CITATION;
    } else {
      grounded = String(input.finalResponse);
    }
  }

  if ((input.rewriteTranscript ?? true) && grounded !== previous) {
    rewriteAssistantTranscript(input.messages, grounded, previous);
  }
  return grounded;
}

function parseCitationLabel(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^\[(\d{1,2})\]$/);
  if (!match) {
    return null;
  }
  const n = Number.parseInt(match[1], 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function hitLabel(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.label === "string") {
    return value.label;
  }
  return isRecord(value.citation) ? value.citation.label : undefined;
}

function labelForChunk(ledger: TurnEvidenceLedger, chunkId: string): number | null {
  for (const [label, identity] of ledger.byLabel) {
    if (identity.chunkId === chunkId) {
      return label;
    }
  }
  return null;
}

function nextSequentialLabel(ledger: TurnEvidenceLedger): number {
  if (ledger.byLabel.size === 0) {
    return 1;
  }
  return Math.max(...ledger.byLabel.keys()) + 1;
}

function addIdentity(
  ledger: TurnEvidenceLedger,
  identity: EvidenceIdentity,
  label?: unknown,
): number | null {
  if (!identity.chunkId) {
    return null;
  }
  const requested = parseCitationLabel(label);
  const existing = ledger.byChunkId.get(identity.chunkId);
  if (existing) {
    if (!existing.text && identity.text) {
      existing.text = identity.text;
      existing.section = identity.section;
    }
    const current = labelForChunk(ledger, identity.chunkId);
    if (requested !== null) {
      const occupant = ledger.byLabel.get(requested);
      if (occupant && occupant.chunkId !== identity.chunkId) {
        ledger.labelConflict = true;
      }
      if (current !== null && current !== requested) {
        ledger.labelConflict = true;
      }
    }
    return current;
  }
  if (requested !== null) {
    const occupant = ledger.byLabel.get(requested);
    if (occupant && occupant.chunkId !== identity.chunkId) {
      ledger.labelConflict = true;
      return null;
    }
  }
  const assigned = requested ?? nextSequentialLabel(ledger);
  ledger.byChunkId.set(identity.chunkId, identity);
  ledger.identities.push(identity);
  ledger.byLabel.set(assigned, identity);
  return assigned;
}

function identityFromHit(hit: unknown): EvidenceIdentity | null {
  if (!isRecord(hit)) {
    return null;
  }
  let chunkId = hit.chunk_id;
  if (typeof chunkId !== "string" || !chunkId.trim()) {
    chunkId = isRecord(hit.citation) ? hit.citation.chunk_id : undefined;
  }
  if (typeof chunkId !== "string" || !chunkId.trim()) {
    return null;
  }
  const citation = isRecord(hit.citation) ? hit.citation : {};
  let documentId = typeof citation.document_id === "string" ? citation.document_id : "";
  const version =
    typeof citation.version === "string" && citation.version.trim() ? citation.version : null;
  if (!documentId && typeof hit.document_id === "string") {
    documentId = hit.document_id;
  }
  return {
    chunkId: chunkId.trim(),
    documentId,
    version,
    section:
      typeof citation.section_heading === "string" ? citation.section_heading : "",
    text: typeof hit.content === "string" ? hit.content : "",
  };
}

function identityFromCitation(citation: unknown): EvidenceIdentity | null {
  if (!isRecord(citation)) {
    return null;
  }
  const chunkId = citation.chunk_id;
  if (typeof chunkId !== "string" || !chunkId.trim()) {
    return null;
  }
  return {
    chunkId: chunkId.trim(),
    documentId: typeof citation.document_id === "string" ? citation.document_id : "",
    version:
      typeof citation.version === "string" && citation.version.trim() ? citation.version : null,
    section:
      typeof citation.section_heading === "string" ? citation.section_heading : "",
    text: "",
  };
}

function parseToolPayload(content: unknown): unknown {
  if (content === null || content === undefined) {
    return null;
  }
  if (typeof content === "object") {
    return content;
  }
  if (typeof content !== "string") {
    return null;
  }
  const text = content.trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isSyntheticUserMessage(msg: TranscriptMessage): boolean {
  if (SYNTHETIC_USER_FLAGS.some((flag) => Boolean(msg[flag]))) {
    return true;
  }
  const content = msg.content;
  if (typeof content === "string" && content.toLowerCase().includes("incomplete") && content.startsWith("[")) {
    return content.startsWith("[System:") || content.includes("Continue now");
  }
  return false;
}

function isAnswerBearing(
  finalResponse: string | null | undefined,
  interrupted: boolean,
  failed: boolean,
): boolean {
  if (interrupted || failed || finalResponse === null || finalResponse === undefined) {
    return false;
  }
  const text = String(finalResponse).trim();
  if (!text || text === "(empty)") {
    return false;
  }
  return !HOST_STRINGS.has(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
