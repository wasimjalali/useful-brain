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
  score?: number;
  vectorScore?: number | null;
  keywordScore?: number | null;
  fusedScore?: number | null;
  rerankScore?: number | null;
};

export type TurnEvidenceLedger = {
  identities: EvidenceIdentity[];
  byChunkId: Map<string, EvidenceIdentity>;
  byLabel: Map<number, EvidenceIdentity>;
  successfulSearchCount: number;
  emptyOrInsufficient: boolean;
  searchError: boolean;
  labelConflict: boolean;
  /** Searches this turn whose vector channel failed and ran keyword-only. */
  vectorDegradedCount: number;
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
    vectorDegradedCount: 0,
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

const INSUFFICIENT_SIGNAL_RES = [
  /\b(?:i|we)\s+(?:do not|don't|cannot|can't)\s+(?:have|find)\b[^.]{0,80}\b(?:evidence|information|documentation)\b/iu,
  /\b(?:not?|insufficient|lacking)\s+enough\s+(?:retrieved\s+)?(?:evidence|information)\b/iu,
  /\b(?:retrieved\s+)?(?:evidence|documents?)\s+do(?:es)?\s+not\s+(?:answer|state|mention|cover|address|support|include|contain|specify)\b/iu,
  /\bno\s+retrieved\s+(?:evidence|information|documents?)\b/iu,
  /\binsufficient[_\s]evidence\b/iu,
];

const MAX_REFUSAL_LENGTH = 240;

/**
 * Detect a model-authored refusal that did not use the exact host string.
 * The host honors an intended abstention instead of routing it through
 * citation repair, which could otherwise turn a refusal into a grounded
 * answer built from a lexically similar but off-topic evidence span.
 *
 * Anchored to the whole response: a refusal is short and carries no
 * citation markers. Grounded prose that quotes a negative-sounding policy
 * sentence ("This document does not cover contractor travel.[1]") must
 * never match, so any marker or long draft disqualifies the text.
 */
export function modelSignalsInsufficientEvidence(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (HOST_STRINGS.has(trimmed)) {
    return true;
  }
  if (citedMarkerIndexes(trimmed).length > 0 || trimmed.length > MAX_REFUSAL_LENGTH) {
    return false;
  }
  return INSUFFICIENT_SIGNAL_RES.some((pattern) => pattern.test(trimmed));
}

/**
 * Append the marker of every ledger identity whose text contains one of a
 * paragraph's claim sentences. Only labels from the current-turn ledger are
 * ever added, so the must-retrieve and citation-validity contracts hold.
 */
export function completeProseCitations(text: string, ledger: TurnEvidenceLedger): string {
  if (!text || ledger.labelConflict || ledger.byLabel.size === 0) {
    return text;
  }
  const markerMatcher = new RegExp(MARKER_RE.source, "g");
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        return paragraph;
      }
      const cited = new Set(citedMarkerIndexes(trimmed));
      const sentences = trimmed
        .replace(markerMatcher, "")
        .split(/(?<=[.!?])\s+/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      const additions: number[] = [];
      for (const [label, identity] of [...ledger.byLabel.entries()].sort((a, b) => a[0] - b[0])) {
        if (cited.has(label)) {
          continue;
        }
        if (
          sentences.some((sentence) =>
            textSupportedByPassages(sentence, [identity.section, identity.text]),
          )
        ) {
          cited.add(label);
          additions.push(label);
        }
      }
      if (additions.length === 0) {
        return paragraph;
      }
      return `${paragraph.trimEnd()}${additions.map((label) => `[${label}]`).join("")}`;
    })
    .join("\n\n");
}

const SALVAGE_MAX_PARAGRAPHS = 6;

/**
 * Rebuild an invalid draft from its verbatim evidence spans. Models often
 * wrap a correctly copied sentence in a bold label, quotation marks or a
 * source attribution ("**Part one:** \"quote\" [1] — from file.md"), which
 * fails whole-paragraph validation. This keeps every span that copies a
 * current-turn evidence text exactly, labels it from the ledger, and drops
 * everything else. Returns null when no verbatim span exists.
 */
export function salvageVerbatimQuotes(
  text: string,
  ledger: TurnEvidenceLedger,
): string | null {
  if (!text || ledger.labelConflict || ledger.byLabel.size === 0) {
    return null;
  }
  const markerMatcher = new RegExp(MARKER_RE.source, "g");
  const labelEntries = [...ledger.byLabel.entries()].sort((a, b) => a[0] - b[0]);
  const kept: Array<{ key: string; paragraph: string }> = [];
  for (const paragraph of text.split(/\n\s*\n/u)) {
    const stripped = paragraph.replace(markerMatcher, "").trim();
    if (!stripped) {
      continue;
    }
    const candidates: string[] = [];
    for (const match of stripped.matchAll(/["“]([^"”]{10,})["”]/gu)) {
      candidates.push(match[1]);
    }
    for (const sentence of stripped.split(/(?<=[.!?])\s+/u)) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) {
        continue;
      }
      candidates.push(trimmedSentence);
      // Accept the after-colon remainder only when the prefix reads as a
      // short label. A long or number-bearing prefix is a claim of its own,
      // and dropping it would change the remainder's meaning.
      const colon = trimmedSentence.indexOf(":");
      if (colon >= 0 && colon < trimmedSentence.length - 1) {
        const prefix = trimmedSentence.slice(0, colon).replace(/[*"“”]+/gu, "").trim();
        if (prefix.split(/\s+/u).length <= 4 && !/\d/u.test(prefix)) {
          candidates.push(trimmedSentence.slice(colon + 1).trim());
        }
      }
    }
    // Validate every candidate first, then keep longest-first so a quoted
    // fragment can never suppress the complete sentence that contains it.
    const validated: Array<{ key: string; paragraph: string }> = [];
    for (const candidate of candidates) {
      const clean = candidate
        .replace(/^["“*\s]+/u, "")
        .replace(/["”*\s]+$/u, "")
        .trim();
      if (!clean || clean.split(/\s+/u).length < 3) {
        continue;
      }
      // Support requires the evidence body text: a span that matches only a
      // section heading is not a statement of the fact.
      const labels = labelEntries
        .filter(([, identity]) => textSupportedByPassages(clean, [identity.text]))
        .map(([label]) => label);
      if (labels.length === 0) {
        continue;
      }
      validated.push({
        key: salvageKey(clean),
        paragraph: `${clean}${labels.map((label) => `[${label}]`).join("")}`,
      });
    }
    validated.sort((a, b) => b.key.length - a.key.length);
    for (const entry of validated) {
      if (kept.some((existing) => existing.key.includes(entry.key) || entry.key.includes(existing.key))) {
        continue;
      }
      kept.push(entry);
      if (kept.length >= SALVAGE_MAX_PARAGRAPHS) {
        break;
      }
    }
    if (kept.length >= SALVAGE_MAX_PARAGRAPHS) {
      break;
    }
  }
  return kept.length > 0 ? kept.map((entry) => entry.paragraph).join("\n\n") : null;
}

function salvageKey(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).join(" ");
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
