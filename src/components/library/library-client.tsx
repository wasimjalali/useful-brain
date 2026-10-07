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
  const [requestFailed, setRequestFailed] = useState(false);

  const matched = useMemo(() => filterDocuments(documents, query), [documents, query]);
  const chips = useMemo(() => buildChips(matched), [matched]);
  const rows = useMemo(() => toRows(matched, department), [matched, department]);

  return (
    <LibraryBody
      chips={chips}
      department={department}
      loading={loading}
      onAsk={(documentId) => router.push(`/chat?scope=${encodeURIComponent(documentId)}`)}
      onDepartmentChange={setDepartment}
      onQueryChange={setQuery}
      onRequest={async (question) => {
        const result = await requestDocumentAction(question);
        setRequestFailed(!result.ok);
        if (result.ok) {
          setRequestedQueries((current) => new Set(current).add(question.trim()));
        }
      }}
      query={query}
      requestError={requestFailed}
      requested={requestedQueries.has(query.trim())}
      rows={rows}
    />
  );
}
