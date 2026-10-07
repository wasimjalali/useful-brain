"use client";

import { useState } from "react";

import { CopyIcon, FileTextIcon, RotateCcwIcon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import { CitationChip } from "@/components/ui/citation-chip";
import { Dialog } from "@/components/ui/dialog";
import { Field, SearchField } from "@/components/ui/field";
import { FilterChip } from "@/components/ui/filter-chip";
import { Highlight } from "@/components/ui/highlight";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import {
  AnswerSkeleton,
  PassageSkeleton,
  TableRowsSkeleton,
} from "@/components/ui/skeleton";
import { StatusDot, StatusPill } from "@/components/ui/status";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
  TableRowActions,
} from "@/components/ui/table";

/* Forced states for review only. Real components use :hover, :active and
   :focus-visible; these attribute selectors mirror them so the sheet can show
   every state at once. */
const FORCE_CSS = `
.dc-force [data-force="focus"] { outline: none; box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.dc-force .ub-btn[data-force="focus"][data-variant="secondary"] { box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.dc-force .ub-btn[data-force="hover"][data-variant="primary"] { opacity: .86; }
.dc-force .ub-btn[data-force="hover"][data-variant="secondary"] { background: var(--border-strong); }
.dc-force .ub-btn[data-force="hover"][data-variant="ghost"] { background: var(--sunken); }
.dc-force .ub-btn[data-force="active"][data-variant="primary"] { opacity: .76; transform: scale(.98); }
.dc-force .ub-btn[data-force="active"][data-variant="secondary"] { background: var(--border-strong); transform: scale(.98); }
.dc-force .ub-btn[data-force="active"][data-variant="ghost"] { background: var(--border-strong); transform: scale(.98); }
.dc-force .ub-iconbtn[data-force="hover"] { background: var(--sunken); color: var(--ink); }
.dc-force .ub-iconbtn[data-force="active"] { background: var(--border-strong); color: var(--ink); }
.dc-force .ub-chip[data-force="hover"] { background: var(--border-strong); }
.dc-force .ub-cite[data-force="hover"] { background: var(--accent); color: var(--accent-ink); }
.dc-force .ub-tr[data-force="hover"] { background: var(--sunken); }
.dc-force .ub-tr[data-force="hover"] .ub-tr-actions { opacity: 1; }
`;

const STATES = ["default", "hover", "focus", "active", "disabled"] as const;

function force(state: (typeof STATES)[number]) {
  return state === "default" || state === "disabled"
    ? {}
    : ({ "data-force": state } as Record<string, string>);
}

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-3 [grid-template-columns:96px_1fr]">
      <span className="text-xs font-medium text-ink-faint-text">{name}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <h2 className="text-xs font-medium text-ink-faint-text">{title}</h2>
      {children}
    </section>
  );
}

export function DesignCheckPanel({ theme }: { theme: "light" | "dark" }) {
  const [view, setView] = useState("cited");
  const [theme3, setTheme3] = useState("system");
  const [query, setQuery] = useState("leave");
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  return (
    <div
      className="dc-force rounded-3xl bg-canvas p-2.5 text-ink"
      data-theme={theme}
      style={{ ["--ring-bg" as string]: "var(--surface)" }}
    >
      <style>{FORCE_CSS}</style>
      <div
        className="flex flex-col gap-5 rounded-3xl bg-surface p-6"
        style={{ boxShadow: "0 0 0 1px var(--edge), var(--stage-shadow)" }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">Design check, {theme}</h1>

        <Group title="Buttons">
          {(["primary", "secondary", "ghost"] as const).map((variant) => (
            <Row key={variant} name={variant}>
              {STATES.map((state) => (
                <Button
                  disabled={state === "disabled"}
                  icon={variant === "secondary" ? <RotateCcwIcon className="size-3.5" /> : undefined}
                  key={state}
                  size={36}
                  title={state}
                  variant={variant}
                  {...force(state)}
                >
                  {variant === "primary" ? "Approve and run" : "Retry"}
                </Button>
              ))}
            </Row>
          ))}
          <Row name="sizes">
            <Button size={32} variant="primary">32</Button>
            <Button size={34} variant="primary">34</Button>
            <Button size={36} variant="primary">36</Button>
          </Row>
          <Row name="icon">
            {STATES.map((state) => (
              <IconButton
                aria-label={`Copy ${state}`}
                disabled={state === "disabled"}
                key={state}
                {...force(state)}
              >
                <CopyIcon className="size-[15px]" />
              </IconButton>
            ))}
          </Row>
        </Group>

        <Group title="Chips">
          <Row name="filter">
            {STATES.map((state) => (
              <FilterChip count={12} disabled={state === "disabled"} key={state} {...force(state)}>
                {state}
              </FilterChip>
            ))}
            <FilterChip count={34} pressed>All</FilterChip>
          </Row>
          <Row name="citation">
            <CitationChip n={1} />
            <CitationChip data-force="hover" n={2} />
            <CitationChip data-force="focus" n={3} />
            <CitationChip active={pinned} n={4} onClick={() => setPinned((v) => !v)} />
          </Row>
          <Row name="status">
            <StatusPill tone="active">Active</StatusPill>
            <StatusPill tone="draft">Draft</StatusPill>
            <StatusPill tone="failed">Failed</StatusPill>
            <StatusDot tone="success" />
            <StatusDot tone="warning" />
            <StatusDot tone="danger" />
            <StatusDot tone="faint" />
            <Kbd>esc</Kbd>
            <Kbd>⌘K</Kbd>
          </Row>
        </Group>

        <Group title="Segmented">
          <Row name="radiogroup">
            <Segmented
              label="Theme"
              onChange={setTheme3}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              value={theme3}
            />
          </Row>
          <Row name="tablist">
            <Segmented
              label="Evidence"
              mode="tablist"
              onChange={setView}
              options={[
                { value: "cited", label: "Cited", count: 2 },
                { value: "retrieved", label: "Retrieved", count: 8 },
              ]}
              value={view}
            />
          </Row>
        </Group>

        <Group title="Fields">
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <Field label="Default" placeholder="Email" />
            <Field defaultValue="maya.chen@northwind.example" label="Filled, 44" size={44} />
            <Field defaultValue="maya.chen@gmail.com" error="Use your Northwind email." label="Error" />
            <Field defaultValue="jordan.ellis@northwind.example" disabled label="Disabled" />
          </div>
          <SearchField label="Search titles and sections" onChange={setQuery} placeholder="Search titles and sections" value={query} width={340} />
        </Group>

        <Group title="Table">
          <Table columns="minmax(0,1.6fr) 120px minmax(0,1fr) 140px" label="Documents">
            <TableHeaderRow>
              <TableHead>Document</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Who can read</TableHead>
              <TableHead>{" "}</TableHead>
            </TableHeaderRow>
            {["Parental Leave Policy", "P1 Incident Response"].map((title, index) => (
              <TableRow key={title} {...(index === 0 ? { "data-force": "hover" } : {})}>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-sm font-medium">
                    <FileTextIcon className="size-4 text-ink-muted" />
                    {title}
                  </span>
                </TableCell>
                <TableCell>{index === 0 ? "HR" : "Support"}</TableCell>
                <TableCell>Everyone</TableCell>
                <TableRowActions>
                  <Button size={32} variant="secondary">Ask about this</Button>
                </TableRowActions>
              </TableRow>
            ))}
          </Table>
        </Group>

        <Group title="Highlight and alert">
          <p className="text-[13px] leading-[21px] text-ink-muted">
            You get <Highlight>sixteen weeks of fully paid parental leave</Highlight> per child.
            Eligible after <Highlight active>six months of continuous service</Highlight>.
          </p>
          <InlineAlert action={{ label: "Retry", onClick: () => {} }}>
            The answer stopped before it finished. Your question is saved.
          </InlineAlert>
        </Group>

        <Group title="Loading">
          <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <AnswerSkeleton />
            <TableRowsSkeleton rows={4} />
            <PassageSkeleton />
          </div>
        </Group>

        <Group title="Dialog">
          <div className="dialog-panel" style={{ width: 360, maxWidth: "100%", animation: "none" }}>
            <div className="flex flex-col gap-3 p-5">
              <h3 className="text-base font-semibold">Upload documents</h3>
              <div className="flex justify-end gap-2">
                <Button variant="ghost">Cancel</Button>
                <Button variant="primary">Add to draft</Button>
              </div>
            </div>
          </div>
          <Row name="live">
            <Button onClick={() => setOpen(true)}>Open dialog</Button>
          </Row>
        </Group>
      </div>
      {open ? (
        <Dialog ariaLabel="Example dialog" onClose={() => setOpen(false)} top={96} width={480}>
          <div data-theme={theme} className="flex flex-col gap-3 rounded-2xl bg-surface p-5 text-ink">
            <h3 className="text-base font-semibold">Example dialog</h3>
            <Field label="Name" />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)} variant="ghost">Cancel</Button>
              <Button onClick={() => setOpen(false)} variant="primary">Save</Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
