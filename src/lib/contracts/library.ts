/** Wire contracts for the Library reader, Library list and global search. */

export type DocumentReaders = {
  kind: "everyone" | "departments" | "roles" | "private";
  /** Department or role names. Empty for everyone and private (never a user id). */
  names: string[];
};

export type LibraryDocument = {
  id: string;
  title: string;
  department: string | null;
  readers: DocumentReaders;
  headings: string[];
};

export type LibraryResponse = { documents: LibraryDocument[] };

export type DocumentSection = { heading: string; text: string };

/** Offsets are character positions inside `sections[section].text`. */
export type DocumentSpan = {
  section: number;
  start: number;
  end: number;
  citation: string;
  active: boolean;
};

export type DocumentResponse = {
  id: string;
  title: string;
  version: string | null;
  effectiveDate: string | null;
  ownerDepartment: string | null;
  readers: DocumentReaders;
  sections: DocumentSection[];
  /** Present only when the message cited this document and the body is exact. */
  spans?: DocumentSpan[];
};

/** [start, end) character ranges over the returned title. */
export type MatchRange = [number, number];

export type ChatSearchHit = {
  id: string;
  title: string;
  titleMatches: MatchRange[];
  snippet: string | null;
};

export type DocumentSearchHit = {
  id: string;
  title: string;
  department: string | null;
  titleMatches: MatchRange[];
  /** "Section · text…" taken from the document body. */
  snippet: string | null;
};

export type SearchResponse = {
  chats: ChatSearchHit[];
  documents: DocumentSearchHit[];
};
