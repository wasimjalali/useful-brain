"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CitationLinkProvider } from "@/components/chat/evidence";
import { DocumentReader } from "@/components/chat/evidence/document-reader";
import { EvidencePanel } from "@/components/chat/evidence/evidence-panel";
import {
  AnswerActions,
  AnswerText,
  ApprovalCard,
  EmptyState,
  ErrorAlert,
  NoEvidence,
  RestrictedNote,
  SourcesRow,
  StatusLine,
  UserBubble,
  ViewAsBanner,
} from "@/components/chat/answer";
import { CategoryBars } from "@/components/admin/evals/category-bars";
import { EvalsFooter, ModelChip } from "@/components/admin/evals/evals-footer";
import { FailuresList } from "@/components/admin/evals/failures-list";
import { RetrievalMetrics } from "@/components/admin/evals/retrieval-metrics";
import { RunsChart } from "@/components/admin/evals/runs-chart";
import { ActivityEmpty } from "@/components/admin/activity/activity-empty";
import { ActivityError } from "@/components/admin/activity/activity-error";
import { ActivityFilters } from "@/components/admin/activity/activity-filters";
import { ActivityTable } from "@/components/admin/activity/activity-table";
import { EvalsSummary } from "@/components/admin/overview/evals-summary";
import { KpiStrip } from "@/components/admin/overview/kpi-strip";
import { SystemHealth } from "@/components/admin/overview/system-health";
import { UnansweredList } from "@/components/admin/overview/unanswered-list";
import { GroupsTable } from "@/components/admin/people/groups-table";
import { InviteDialog } from "@/components/admin/people/invite-dialog";
import { PeopleView } from "@/components/admin/people/people-view";
import { GenerationCard } from "@/components/admin/sources/generation-card";
import { SourcesView } from "@/components/admin/sources/sources-view";
import { UploadDialog } from "@/components/admin/sources/upload-dialog";
import { ProofStage } from "@/components/auth/proof-stage";
import { LibraryBody } from "@/components/library/library-body";
import { SearchDialog } from "@/components/search/search-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import type { CitedPassageView, ReaderDocumentView, RetrievedPassageView } from "@/lib/contracts/chat-view";
import type { LibraryChipView, LibraryRowView, SearchChatRowView, SearchDocumentRowView } from "@/lib/contracts/library-view";
import type { SettingsAccount, SettingsConnector, SettingsModelConfig } from "@/lib/contracts/settings-view";
import type {
  ActiveGenerationView,
  DraftGenerationView,
  GroupRowView,
  InviteState,
  PersonRowView,
  SourceCounts,
  SourceRowView,
  UploadFileView,
} from "@/lib/contracts/admin-manage-view";
import type {
  ActivityFilterView,
  ActivityRowView,
  EvalCategoryView,
  EvalFailureView,
  EvalRunView,
  EvalsSummaryView,
  KpiView,
  RetrievalMetricView,
  SystemRowView,
  UnansweredView,
} from "@/lib/contracts/admin-insights-view";

const noop = () => {};

const SUGGESTIONS = [
  { question: "How much parental leave do I get, and when am I eligible?", department: "HR" },
  { question: "Can I keep my laptop when I leave Northwind?", department: "Operations" },
  { question: "What is the response time for a P1 incident?", department: "Support" },
  { question: "How do I request a travel advance before a trip?", department: "Finance" },
];

const CITED: CitedPassageView[] = [
  {
    n: 1,
    chunkId: "nw_hr_parental_leave:c02",
    document: "Parental Leave Policy",
    section: "Paid Leave Duration",
    text: "Every eligible parent receives sixteen weeks of fully paid parental leave per child, at 100% of base salary.",
    highlights: [{ start: 0, end: 103 }],
    generation: "g-c305cf57",
    keywordScore: 0.868,
    vectorScore: 0.84,
    rerankScore: 0.991,
  },
  {
    n: 2,
    chunkId: "nw_hr_parental_leave:c05",
    document: "Parental Leave Policy",
    section: "Eligibility",
    text: "Employees become eligible after six months of continuous service. Leave is in addition to annual leave and sick leave.",
    highlights: [{ start: 0, end: 52 }],
    generation: "g-c305cf57",
    keywordScore: 0.712,
    vectorScore: 0.803,
    rerankScore: 0.962,
  },
];

const RETRIEVED: RetrievedPassageView[] = [
  { rank: 1, chunkId: "nw_hr_parental_leave:c02", document: "Parental Leave Policy", section: "Paid Leave Duration", cited: true, rerankScore: 0.991 },
  { rank: 2, chunkId: "nw_hr_parental_leave:c05", document: "Parental Leave Policy", section: "Eligibility", cited: true, rerankScore: 0.962 },
  { rank: 3, chunkId: "nw_hr_leave_overview:c01", document: "Leave Overview", section: "Types of leave", cited: false, rerankScore: 0.418 },
  { rank: 4, chunkId: "nw_hr_holidays:c03", document: "Public Holidays", section: "Calendar", cited: false, rerankScore: 0.116 },
];

const READER_DOC: ReaderDocumentView = {
  title: "Parental Leave Policy",
  version: "v3.2",
  effective: "1 March 2026",
  readableBy: { label: "Everyone", everyone: true },
  owner: "HR",
  sections: [
    {
      heading: "Paid Leave Duration",
      paragraphs: [
        [
          { text: "Every eligible parent receives " },
          { text: "sixteen weeks of fully paid parental leave per child, at 100% of base salary.", citation: 1 },
        ],
        [{ text: "Leave starts on the date of birth or placement and can be taken in one block or in two parts within the first year." }],
      ],
    },
    {
      heading: "Eligibility",
      paragraphs: [
        [
          { text: "Employees become eligible after six months of continuous service. Leave is in addition to annual leave and sick leave.", citation: 2 },
        ],
      ],
    },
  ],
};

const LIBRARY_ROWS: LibraryRowView[] = [
  { id: "d1", title: "Parental Leave Policy", department: "HR", readers: "Everyone" },
  { id: "d2", title: "P1 Incident Response", department: "Support", readers: "Support, Engineering" },
  { id: "d3", title: "Travel and Expenses", department: "Finance", readers: "Everyone" },
];

const LIBRARY_CHIPS: LibraryChipView[] = [
  { label: "All", count: 148 },
  { label: "HR", count: 21 },
  { label: "Support", count: 18 },
  { label: "Finance", count: 14 },
];

const SEARCH_CHATS: SearchChatRowView[] = [
  { id: "c1", title: "Parental leave eligibility", titleMatches: [[0, 5]], dateLabel: "2d" },
  { id: "c2", title: "Leave for contractors", titleMatches: [[0, 5]], dateLabel: "9d" },
];

const SEARCH_DOCS: SearchDocumentRowView[] = [
  {
    id: "d1",
    title: "Parental Leave Policy",
    titleMatches: [[11, 15]],
    department: "HR",
    snippet: "Paid Leave Duration · Every eligible parent receives sixteen weeks of fully paid leave.",
  },
  { id: "d4", title: "Leave Overview", titleMatches: [[0, 5]], department: "HR", snippet: null },
];

const ACCOUNT: SettingsAccount = {
  name: "Maya Chen",
  email: "maya.chen@northwind.example",
  role: "Member",
  department: "Engineering",
  readableDocuments: 148,
};

const ADMIN_ACCOUNT: SettingsAccount = {
  name: "Jordan Ellis",
  email: "jordan.ellis@northwind.example",
  role: "Admin",
  department: "Operations",
  readableDocuments: 148,
  totalDocuments: 65,
};

const MODEL_CONFIG: SettingsModelConfig = {
  answerModel: "@cf/zai-org/glm-5.3-flash",
  embeddingModel: "@cf/qwen/qwen3-embedding-0.6b",
  rerankerModel: "@cf/baai/bge-reranker-base",
  retrieval: "Hybrid, 0.70 vector and 0.30 keyword",
  passagesPerAnswer: 8,
  rerankFloor: 0.05,
  activeGeneration: "g-c305cf57",
};

const CONNECTORS: SettingsConnector[] = [
  { id: "gh", name: "GitHub repositories", description: "Sync Markdown from allowlisted repositories.", status: "connected" },
  { id: "http", name: "HTTP Markdown", description: "Fetch Markdown from approved Northwind origins.", status: "not_connected", connectable: true },
];

const KPIS: KpiView[] = [
  { id: "q", label: "Questions this week", value: "412", delta: "+18%", points: [40, 52, 47, 61, 58, 66, 72], startLabel: "Mon", endLabel: "Sun" },
  { id: "a", label: "Answered with evidence", value: "96%", delta: "+2 pts", points: [92, 94, 93, 95, 96, 95, 96], startLabel: "Mon", endLabel: "Sun" },
  { id: "n", label: "No evidence", value: "14", delta: "-3", points: [4, 3, 2, 3, 2, 1, 2], startLabel: "Mon", endLabel: "Sun" },
  { id: "p", label: "Pending approvals", value: "2", delta: "0", points: [1, 2, 2, 1, 2, 2, 2], startLabel: "Mon", endLabel: "Sun" },
];

const SYSTEM_ROWS: SystemRowView[] = [
  { id: "web", name: "Web", status: "ok" },
  { id: "brain", name: "Brain", status: "ok" },
  { id: "idx", name: "Index freshness", status: "warning", detail: "Draft g-9a41e2 paused" },
  { id: "d1", name: "Operations D1", status: "ok", detail: "4 ms p95", mono: true },
];

const UNANSWERED: UnansweredView[] = [
  { id: "u1", question: "Can contractors take parental leave?", meta: "Last asked 2h ago", asks: 6 },
  { id: "u2", question: "What is the per diem for Lagos travel?", meta: "Last asked yesterday", asks: 3 },
];

const EVALS_SUMMARY: EvalsSummaryView = { passed: 118, total: 120, aclLeaks: 0, latestRunLabel: "8 Oct, 09:10" };

const RETRIEVAL_METRICS: RetrievalMetricView[] = [
  { id: "r", label: "Recall at 8", value: "0.934", tone: "success" },
  { id: "m", label: "MRR", value: "0.861" },
  { id: "n", label: "nDCG", value: "0.872" },
  { id: "l", label: "ACL leaks", value: "0", tone: "success" },
];

const CATEGORIES: EvalCategoryView[] = [
  { id: "f", name: "Factual", passed: 69, total: 70 },
  { id: "t", name: "Trap", passed: 16, total: 17 },
  { id: "p", name: "Permission", passed: 13, total: 13 },
  { id: "u", name: "Unanswerable", passed: 10, total: 10 },
];

const RUNS: EvalRunView[] = [
  { id: "r1", name: "Run 41", date: "1 Oct", passed: 111, total: 120 },
  { id: "r2", name: "Run 42", date: "3 Oct", passed: 114, total: 120 },
  { id: "r3", name: "Run 43", date: "8 Oct", passed: 118, total: 120 },
];

const FAILURES: EvalFailureView[] = [
  {
    id: "q093",
    category: "Multi-hop",
    question: "Which approval does a travel advance above the policy limit need?",
    askedAs: "priya.shah (Support, Member)",
    expected: [{ document: "Travel and Expenses", section: "Advances" }, { document: "Finance Approvals", section: "Limits" }],
    note: "The second hop was retrieved but ranked below the rerank floor.",
  },
  {
    id: "q120",
    category: "Trap",
    question: "Did Halvorsen Freight sign the 2026 renewal?",
    askedAs: "jordan.ellis (Operations, Admin)",
    expected: [],
    note: "The answer named the wrong contract year. Refusal expected.",
  },
];

const ACTIVITY_FILTERS: ActivityFilterView[] = [
  { value: "all", label: "All", count: 42 },
  { value: "answered", label: "Answered", count: 30 },
  { value: "no_evidence", label: "No evidence", count: 6 },
  { value: "denied", label: "Denied", count: 2 },
];

const ACTIVITY_ROWS: ActivityRowView[] = [
  { id: "a1", time: "09:14", person: "Maya Chen", question: "How much parental leave do I get?", outcome: "answered", sources: 2, latency: "1.8 s" },
  { id: "a2", time: "09:02", person: "Priya Shah", question: "Can contractors take parental leave?", outcome: "no_evidence", sources: null, latency: "0.6 s" },
  { id: "a3", time: "08:47", person: "Jordan Ellis", question: "Create a ticket for the laptop return", outcome: "denied", sources: 1, latency: "2.4 s" },
];

const ACTIVE_GEN: ActiveGenerationView = {
  id: "g-c305cf57",
  promotedLabel: "Promoted 6 Oct",
  documents: 65,
  chunks: 1412,
  retrieval: "Hybrid, rerank floor 0.05",
};

const DRAFT_BUILDING: DraftGenerationView = {
  state: "building",
  id: "g-9a41e2",
  embeddedChunks: 640,
  totalChunks: 1412,
  documents: 31,
  failed: 0,
};

const SOURCE_ROWS: SourceRowView[] = [
  {
    id: "s1",
    title: "Parental Leave Policy",
    fileName: "parental-leave.md",
    errorMessage: null,
    department: "HR",
    readers: "Everyone",
    chunks: 14,
    updatedLabel: "6 Oct",
    status: "active",
  },
  {
    id: "s2",
    title: null,
    fileName: null,
    errorMessage: "Could not parse the PDF. Export it again as Markdown.",
    department: "Finance",
    readers: "Finance managers",
    chunks: null,
    updatedLabel: "7 Oct",
    status: "failed",
  },
];

const SOURCE_COUNTS: SourceCounts = { all: 65, active: 63, draft: 1, failed: 1 };

const UPLOAD_FILES: UploadFileView[] = [
  { id: "f1", name: "travel-policy-2026.md", sizeLabel: "48 KB", stage: "embedding" },
  { id: "f2", name: "benefits-guide.pdf", sizeLabel: "3.2 MB", stage: "parsing" },
  { id: "f3", name: "legacy-handbook.docx", sizeLabel: "26 MB", stage: "failed", error: "larger than 25 MB" },
];

const PEOPLE: PersonRowView[] = [
  { id: "p1", name: "Maya Chen", email: "maya.chen@northwind.example", role: "Member", department: "Engineering", readableCount: 148, lastActiveLabel: "Today" },
  { id: "p2", name: "Priya Shah", email: "priya.shah@northwind.example", role: "Member", department: "Support", readableCount: 112, lastActiveLabel: "Yesterday" },
  { id: "p3", name: "Jordan Ellis", email: "jordan.ellis@northwind.example", role: "Admin", department: "Operations", readableCount: 148, lastActiveLabel: "Today" },
];

const GROUPS: GroupRowView[] = [
  { id: "g1", name: "Everyone", type: "Built in", people: 148, addsDocuments: "Admins", rule: "All signed-in people" },
  { id: "g2", name: "Support", type: "Department", people: 18, addsDocuments: "Support managers", rule: "Department is Support" },
  { id: "g3", name: "Finance managers", type: "Role", people: 4, addsDocuments: "Admins", rule: "Role is Finance manager" },
];

const DEPARTMENTS = ["Engineering", "Executive", "Finance", "HR", "Legal", "Operations", "Sales", "Support"];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <h2 className="text-xs font-medium text-ink-faint-text">{title}</h2>
      {children}
    </section>
  );
}

function Sample({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-ink-faint-text">{name}</span>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function AnswerAndEvidence() {
  const [tab, setTab] = useState<"cited" | "retrieved">("cited");
  const [reader, setReader] = useState<number | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<"up" | "down" | null>(null);
  return (
    <CitationLinkProvider>
      <div className="grid gap-5 [grid-template-columns:minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <p className="m-0 text-xs text-ink-faint-text">Hover a citation to link it to its passage.</p>
          <UserBubble>How much parental leave do I get, and when am I eligible?</UserBubble>
          <AnswerText
            paragraphs={[
              { text: "You get sixteen weeks of fully paid parental leave per child, at 100% of base salary.", citations: [1] },
              { text: "You're eligible after six months of continuous service.", citations: [2] },
            ]}
          />
          <SourcesRow
            sources={[
              { n: 1, document: "Parental Leave Policy", section: "Paid Leave Duration" },
              { n: 2, document: "Parental Leave Policy", section: "Eligibility" },
            ]}
          />
          <AnswerActions
            feedback={answerFeedback}
            latencyMs={1840}
            onCopy={noop}
            onFeedback={setAnswerFeedback}
            onRetry={noop}
            passages={2}
          />
        </div>
        <div className="h-[560px] min-w-0">
          {reader === null ? (
            <EvidencePanel
              cited={CITED}
              generation="g-c305cf57"
              isAdmin
              loading={false}
              onClose={noop}
              onOpenDocument={setReader}
              onTabChange={setTab}
              rerankFloor={0.05}
              retrieved={RETRIEVED}
              tab={tab}
            />
          ) : (
            <DocumentReader
              activeN={reader}
              doc={READER_DOC}
              onBack={() => setReader(null)}
              onClose={noop}
              onOpenInLibrary={noop}
            />
          )}
        </div>
      </div>
    </CitationLinkProvider>
  );
}

function ShellDialogs() {
  const [upload, setUpload] = useState(false);
  const [invite, setInvite] = useState<InviteState["status"] | null>(null);
  const [settings, setSettings] = useState<null | "member" | "admin">(null);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("leave");
  return (
    <>
      <Button onClick={() => setSearch(true)} variant="secondary">Open search</Button>
      <Button onClick={() => setUpload(true)} variant="secondary">Open upload</Button>
      <Button onClick={() => setInvite("form")} variant="secondary">Open invite</Button>
      <Button onClick={() => setSettings("member")} variant="secondary">Open settings, member</Button>
      <Button onClick={() => setSettings("admin")} variant="secondary">Open settings, admin</Button>
      {search ? (
        <SearchDialog
          chats={SEARCH_CHATS}
          documents={SEARCH_DOCS}
          loading={false}
          onAskDocument={noop}
          onClose={() => setSearch(false)}
          onOpenChat={noop}
          onOpenDocument={noop}
          onQueryChange={setQuery}
          query={query}
        />
      ) : null}
      {upload ? (
        <UploadDialog
          files={UPLOAD_FILES}
          onCancel={() => setUpload(false)}
          onFilesAdded={noop}
          onScopeChange={noop}
          onSubmit={() => setUpload(false)}
          onToggleGroup={noop}
          peopleCount={148}
          scope="departments"
          selectedGroups={["Support"]}
        />
      ) : null}
      {invite ? (
        <InviteDialog
          departments={DEPARTMENTS}
          onClose={() => setInvite(null)}
          onSubmit={noop}
          state={invite === "form" ? { status: "form" } : { status: "done", link: "https://brain.northwind.example/invite/7f3c", expiresLabel: "Expires in 7 days" }}
        />
      ) : null}
      {settings ? (
        <SettingsDialog
          account={settings === "admin" ? ADMIN_ACCOUNT : ACCOUNT}
          config={settings === "admin" ? MODEL_CONFIG : undefined}
          connectors={settings === "admin" ? CONNECTORS : undefined}
          initialSection={settings === "admin" ? "model" : "appearance"}
          isAdmin={settings === "admin"}
          onClose={() => setSettings(null)}
          onSignOut={noop}
        />
      ) : null}
    </>
  );
}

export function DesignCheckGallery() {
  return (
    <div className="flex flex-col gap-5">
      <Group title="Chat empty state">
        <div className="rounded-2xl bg-canvas p-4">
          <EmptyState
            composer={<div className="h-11 rounded-full bg-bubble px-4 text-[15px] leading-[44px] text-ink-faint-text shadow-[0_0_0_1px_var(--edge),var(--lift)]">Ask a question</div>}
            onPick={noop}
            suggestions={SUGGESTIONS}
          />
        </div>
      </Group>

      <Group title="Answer and evidence">
        <AnswerAndEvidence />
      </Group>

      <Group title="Status line">
        <Sample name="searching">
          <StatusLine progress={{ kind: "searching", readableDocuments: 148 }} />
        </Sample>
        <Sample name="reading">
          <StatusLine progress={{ kind: "reading", passages: 8 }} />
        </Sample>
        <Sample name="writing">
          <StatusLine progress={{ kind: "writing" }} />
        </Sample>
      </Group>

      <Group title="No evidence">
        <NoEvidence documentsSearched={148} latencyMs={620} onRequest={noop} requested={false} />
        <NoEvidence documentsSearched={148} latencyMs={620} onRequest={noop} requested />
      </Group>

      <Group title="Error and partial answer">
        <ErrorAlert onRetry={noop} />
        <ErrorAlert onRetry={noop} partialText="You get sixteen weeks of fully paid parental leave per child, at 100% of base salary." />
      </Group>

      <Group title="Approval card">
        <ApprovalCard
          approval={{
            status: "pending",
            tool: "create_ticket",
            args: [
              ["title", "Laptop return for Maya Chen"],
              ["queue", "IT Support"],
              ["priority", "P3"],
            ],
          }}
          onApprove={noop}
          onDeny={noop}
        />
        <ApprovalCard approval={{ status: "done", ticketId: "SUP-204", meta: "IT Support queue, created 09:14" }} onOpenTicket={noop} />
        <ApprovalCard approval={{ status: "denied" }} />
        <ApprovalCard approval={{ status: "expired" }} />
      </Group>

      <Group title="Banners and notes">
        <ViewAsBanner department="Support" documentCount={112} name="Priya Shah" onExit={noop} />
        <RestrictedNote readers="Executives and HR" title="Executive compensation review" />
      </Group>

      <Group title="Library">
        <LibraryBody
          chips={LIBRARY_CHIPS}
          department="All"
          loading={false}
          onAsk={noop}
          onDepartmentChange={noop}
          onQueryChange={noop}
          onRequest={noop}
          query=""
          rows={LIBRARY_ROWS}
        />
        <LibraryBody
          chips={LIBRARY_CHIPS}
          department="All"
          loading
          onAsk={noop}
          onDepartmentChange={noop}
          onQueryChange={noop}
          onRequest={noop}
          query=""
          rows={[]}
        />
        <LibraryBody
          chips={LIBRARY_CHIPS}
          department="HR"
          loading={false}
          onAsk={noop}
          onDepartmentChange={noop}
          onQueryChange={noop}
          onRequest={noop}
          query="sabbatical"
          rows={[]}
        />
      </Group>

      <Group title="Evidence loading and member view">
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,380px))]">
          <div className="h-[420px]">
            <EvidencePanel
              cited={[]}
              isAdmin={false}
              loading
              onClose={noop}
              onOpenDocument={noop}
              onTabChange={noop}
              retrieved={[]}
              tab="cited"
            />
          </div>
          <div className="h-[420px]">
            <CitationLinkProvider>
              <EvidencePanel
                cited={CITED}
                isAdmin={false}
                onClose={noop}
                onOpenDocument={noop}
                onTabChange={noop}
                retrieved={RETRIEVED}
                tab="retrieved"
              />
            </CitationLinkProvider>
          </div>
        </div>
      </Group>

      <Group title="Document reader">
        <div className="h-[460px] max-w-[380px]">
          <DocumentReader activeN={2} doc={READER_DOC} loading={false} onBack={noop} onClose={noop} onOpenInLibrary={noop} />
        </div>
        <div className="h-[260px] max-w-[380px]">
          <DocumentReader activeN={null} doc={READER_DOC} loading onBack={noop} onClose={noop} onOpenInLibrary={noop} />
        </div>
      </Group>

      <Group title="Admin overview">
        <KpiStrip kpis={KPIS} />
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          <SystemHealth rows={SYSTEM_ROWS} />
          <UnansweredList items={UNANSWERED} onAddDocument={noop} />
        </div>
        <EvalsSummary onOpenEvals={noop} summary={EVALS_SUMMARY} />
      </Group>

      <Group title="Admin evals">
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          <RetrievalMetrics metrics={RETRIEVAL_METRICS} />
          <CategoryBars categories={CATEGORIES} />
        </div>
        <RunsChart runs={RUNS} />
        <FailuresList failures={FAILURES} initiallyOpenId="q093" />
        <Sample name="model">
          <ModelChip model="@cf/zai-org/glm-5.3-flash" />
        </Sample>
        <EvalsFooter />
      </Group>

      <Group title="Admin activity">
        <ActivityFilters filters={ACTIVITY_FILTERS} onChange={noop} value="all" />
        <ActivityTable
          hasMore
          loadTrace={noop}
          onLoadMore={noop}
          rows={ACTIVITY_ROWS}
          traces={{}}
        />
        <ActivityEmpty message="No denied actions this week" onShowAll={noop} />
        <ActivityError onRetry={noop} />
      </Group>

      <Group title="Admin sources">
        <SourcesView
          active={ACTIVE_GEN}
          busy={false}
          counts={SOURCE_COUNTS}
          documentCount={65}
          draft={DRAFT_BUILDING}
          filter="all"
          onDiscard={noop}
          onFilterChange={noop}
          onPromote={noop}
          onQueryChange={noop}
          onReindex={noop}
          onUpload={noop}
          query=""
          rows={SOURCE_ROWS}
        />
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <GenerationCard
            active={ACTIVE_GEN}
            draft={{ state: "checks_passed", id: "g-9a41e2", summary: "1,412 of 1,412 chunks match Vectorize" }}
            onDiscard={noop}
            onPromote={noop}
          />
          <GenerationCard
            active={ACTIVE_GEN}
            draft={{ state: "checks_failed", id: "g-9a41e2", summary: "38 vectors missing. Rebuild before promoting." }}
            onDiscard={noop}
            onPromote={noop}
          />
        </div>
      </Group>

      <Group title="Admin people">
        <PeopleView
          groupCount={3}
          groups={GROUPS}
          onInvite={noop}
          onQueryChange={noop}
          onTabChange={noop}
          onViewAs={noop}
          peopleCount={148}
          people={PEOPLE}
          query=""
          readableTotal={148}
          tab="people"
        />
        <GroupsTable groups={GROUPS} />
      </Group>

      <Group title="Dialogs and overlays">
        <ShellDialogs />
        <div className="rounded-2xl bg-canvas p-2">
          <ProofStage />
        </div>
      </Group>
    </div>
  );
}
