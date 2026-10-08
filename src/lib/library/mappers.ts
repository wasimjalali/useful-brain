import type { DocumentReaders, LibraryDocument } from "@/lib/contracts/library";
import type { LibraryChipView, LibraryRowView } from "@/lib/contracts/library-view";

const NO_DEPARTMENT = "General";

const ROLE_LABELS: Record<string, string> = {
  manager: "Managers",
  director: "Directors",
  executive: "Executives",
  hr_manager: "HR managers",
  finance_manager: "Finance managers",
  support_manager: "Support managers",
  sales_manager: "Sales managers",
};

function capitalize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Wire department ids ("hr", "sales") as people read them ("HR", "Sales"). */
export function departmentLabel(name: string): string {
  return name === "hr" ? "HR" : capitalize(name);
}

export function readersLabel(readers: DocumentReaders): string {
  switch (readers.kind) {
    case "everyone":
      return "Everyone";
    case "private":
      return "Only you";
    case "roles":
      return readers.names.map((name) => ROLE_LABELS[name] ?? capitalize(name)).join(", ");
    default:
      return readers.names.map(departmentLabel).join(", ");
  }
}

function departmentOf(document: LibraryDocument): string {
  return document.department ? departmentLabel(document.department) : NO_DEPARTMENT;
}

export function filterDocuments(documents: LibraryDocument[], query: string): LibraryDocument[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return documents;
  }
  return documents.filter(
    (document) =>
      document.title.toLowerCase().includes(needle) ||
      document.headings.some((heading) => heading.toLowerCase().includes(needle)),
  );
}

/** Chips and counts come from the set passed in, so they follow the query. */
export function buildChips(documents: LibraryDocument[]): LibraryChipView[] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const department = departmentOf(document);
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }
  return [
    { label: "All", count: documents.length },
    ...[...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count })),
  ];
}

export function toRows(documents: LibraryDocument[], department: string): LibraryRowView[] {
  return documents
    .filter((document) => department === "All" || departmentOf(document) === department)
    .map((document) => ({
      id: document.id,
      title: document.title,
      department: departmentOf(document),
      readers: readersLabel(document.readers),
    }));
}
