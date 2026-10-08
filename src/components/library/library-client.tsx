"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { requestDocumentAction } from "@/app/library-actions";
import type { LibraryDocument } from "@/lib/contracts/library";
import { buildChips, filterDocuments, toRows } from "@/lib/library/mappers";

import { LibraryBody } from "./library-body";

export function LibraryClient({
  documents,
  loading = false,
}: {
  documents: LibraryDocument[];
  loading?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");
  const [requestedQueries, setRequestedQueries] = useState<ReadonlySet<string>>(new Set());
  const [failedQuery, setFailedQuery] = useState<string | null>(null);

  const matched = useMemo(() => filterDocuments(documents, query), [documents, query]);
  const chips = useMemo(() => buildChips(matched), [matched]);
  // A chip that no longer exists for this query must not leave the table filtered to nothing.
  const activeDepartment = chips.some((chip) => chip.label === department) ? department : "All";
  const rows = useMemo(() => toRows(matched, activeDepartment), [matched, activeDepartment]);

  return (
    <LibraryBody
      chips={chips}
      department={activeDepartment}
      loading={loading}
      onAsk={(documentId) => router.push(`/chat?scope=${encodeURIComponent(documentId)}`)}
      onDepartmentChange={setDepartment}
      onQueryChange={setQuery}
      onRequest={async (question) => {
        const result = await requestDocumentAction(question);
        setFailedQuery(result.ok ? null : question.trim());
        if (result.ok) {
          setRequestedQueries((current) => new Set(current).add(question.trim()));
        }
      }}
      query={query}
      requestError={failedQuery !== null && failedQuery === query.trim()}
      requested={requestedQueries.has(query.trim())}
      rows={rows}
    />
  );
}
