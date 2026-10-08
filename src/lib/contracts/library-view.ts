/** View models for the Library page body and the search dialog. */
import type { MatchRange } from "@/lib/contracts/library";

export type LibraryRowView = {
  id: string;
  title: string;
  department: string;
  /** Already formatted, e.g. "Everyone" or "Support, Engineering". */
  readers: string;
};

export type LibraryChipView = { label: string; count: number };

export type SearchChatRowView = {
  id: string;
  title: string;
  titleMatches: MatchRange[];
  /** Already formatted relative date, e.g. "2d". */
  dateLabel: string;
};

export type SearchDocumentRowView = {
  id: string;
  title: string;
  titleMatches: MatchRange[];
  department: string;
  /** "Section · text…" or null. */
  snippet: string | null;
};
