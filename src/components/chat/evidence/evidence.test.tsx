import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  CitedPassageView,
  EvidenceTab,
  ReaderDocumentView,
  RetrievedPassageView,
  SourceRefView,
} from "@/lib/contracts/chat-view";

import { AnswerText } from "../answer/answer-text";
import { SourcesRow } from "../answer/sources-row";
import { CitationLinkProvider } from "./citation-link";
import { DocumentReader } from "./document-reader";
import { EvidencePanel } from "./evidence-panel";

const sources: SourceRefView[] = [
  { n: 1, document: "Parental Leave Policy", section: "Paid Leave Duration" },
  { n: 2, document: "Parental Leave Policy", section: "Overview and Eligibility" },
];

const cited: CitedPassageView[] = [
  {
    n: 1,
    chunkId: "nw_hr_parental_leave:c02",
    document: "Parental Leave Policy",
    section: "Paid Leave Duration",
    text: "Eligible employees receive sixteen weeks of fully paid leave.",
    highlights: [{ start: 19, end: 60 }],
    generation: "g-c305cf57",
    keywordScore: 0.868,
    vectorScore: 0.84,
    rerankScore: 0.991,
  },
  {
    n: 2,
    chunkId: "nw_hr_parental_leave:c01",
    document: "Parental Leave Policy",
    section: "Overview and Eligibility",
    text: "Eligibility starts after six months of continuous service.",
    highlights: [{ start: 0, end: 11 }],
  },
];

const retrieved: RetrievedPassageView[] = [
  { rank: 1, chunkId: "a", document: "Parental Leave Policy", section: "Paid Leave Duration", cited: true, rerankScore: 0.991 },
  { rank: 2, chunkId: "b", document: "Parental Leave Policy", section: "Overview and Eligibility", cited: true, rerankScore: 0.974 },
  { rank: 3, chunkId: "c", document: "Employee Handbook", section: "Time Away from Work", cited: false, rerankScore: 0.388 },
];

function Harness({ isAdmin = false, onOpen = vi.fn() }: { isAdmin?: boolean; onOpen?: (n: number) => void }) {
  const [tab, setTab] = useState<EvidenceTab>("cited");
  return (
    <CitationLinkProvider>
      <AnswerText
        paragraphs={[{ text: "Sixteen weeks [1]. After six months [2].", citations: [1, 2] }]}
      />
      <SourcesRow sources={sources} />
      <EvidencePanel
        cited={cited}
        generation="g-c305cf57"
        isAdmin={isAdmin}
        onClose={() => {}}
        onOpenDocument={onOpen}
        onTabChange={setTab}
        rerankFloor={0.05}
        retrieved={retrieved}
        tab={tab}
      />
    </CitationLinkProvider>
  );
}

function passageRow(n: number) {
  return document.querySelector(`[data-passage="${n}"]`) as HTMLElement;
}

describe("linked citation hover", () => {
  it("hovering chip 2 activates source 2 and passage 2 only", () => {
    render(<Harness />);
    const chips = screen.getAllByRole("button", { name: "Citation 2" });
    fireEvent.mouseEnter(chips[0]);
    expect(chips[0]).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: /^Source 2/ })).toHaveAttribute("data-active", "true");
    expect(passageRow(2)).toHaveAttribute("data-active", "true");
    expect(passageRow(2).querySelector("mark")).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: /^Source 1/ })).not.toHaveAttribute("data-active");
    expect(passageRow(1)).not.toHaveAttribute("data-active");
    fireEvent.mouseLeave(chips[0]);
    expect(passageRow(2)).not.toHaveAttribute("data-active");
  });

  it("hovering a source button activates the chip and passage", () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Source 1/ }));
    expect(screen.getAllByRole("button", { name: "Citation 1" })[0]).toHaveAttribute("data-active", "true");
    expect(passageRow(1)).toHaveAttribute("data-active", "true");
  });

  it("click pins, a second click unpins, pin survives mouse leave", () => {
    render(<Harness />);
    const chip = screen.getAllByRole("button", { name: "Citation 1" })[0];
    fireEvent.mouseEnter(chip);
    fireEvent.click(chip);
    fireEvent.mouseLeave(chip);
    expect(passageRow(1)).toHaveAttribute("data-active", "true");
    fireEvent.click(chip);
    expect(passageRow(1)).not.toHaveAttribute("data-active");
  });

  it("scrolls the active passage into view", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Harness />);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "Citation 2" })[0]);
    expect(scroll).toHaveBeenCalled();
  });
});

describe("EvidencePanel", () => {
  it("is a labelled complementary region with a real tablist", () => {
    render(<Harness />);
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /Cited/ })).toHaveAttribute("aria-selected", "true");
  });

  it("switches between Cited and Retrieved", () => {
    render(<Harness />);
    expect(screen.queryByText("Employee Handbook")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Retrieved/ }));
    expect(screen.getByText("Employee Handbook")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getAllByText("Cited")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: /Cited/ }));
    expect(screen.queryByText("Employee Handbook")).not.toBeInTheDocument();
  });

  it("hides diagnostics from members", () => {
    render(<Harness />);
    expect(screen.queryByText("nw_hr_parental_leave:c02")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retrieval details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Retrieved/ }));
    expect(screen.queryByText(/Rerank score · floor/)).not.toBeInTheDocument();
    expect(screen.queryByText("0.991")).not.toBeInTheDocument();
  });

  it("puts collapsed retrieval details below Open document for admins", () => {
    window.localStorage.clear();
    render(<Harness isAdmin />);
    const toggle = screen.getAllByRole("button", { name: "Retrieval details" })[0];
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("nw_hr_parental_leave:c02")).not.toBeInTheDocument();
    const open = screen.getAllByRole("button", { name: /Open document/ })[0];
    expect(open.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("nw_hr_parental_leave:c02")).toHaveAttribute(
      "title",
      "nw_hr_parental_leave:c02",
    );
    expect(screen.getAllByText("0.868")[0]).toBeInTheDocument();
    expect(screen.getAllByText("0.840")[0]).toBeInTheDocument();
    expect(screen.getAllByText("0.991")[0]).toBeInTheDocument();
    expect(screen.getAllByText("g-c305cf57")[0]).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy chunk ID" })[0]).toBeInTheDocument();
  });

  it("remembers the open state", () => {
    window.localStorage.clear();
    const first = render(<Harness isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Retrieval details" })[0]);
    first.unmount();
    render(<Harness isAdmin />);
    expect(screen.getAllByRole("button", { name: "Retrieval details" })[0]).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    window.localStorage.clear();
  });

  it("copies the chunk id and shows Copied", async () => {
    window.localStorage.clear();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Retrieval details" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy chunk ID" })[0]);
    expect(writeText).toHaveBeenCalledWith("nw_hr_parental_leave:c02");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    window.localStorage.clear();
  });

  it("shows Copy failed, never Copied, when the clipboard rejects", async () => {
    window.localStorage.clear();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Retrieval details" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy chunk ID" })[0]);
    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).toBeNull();
    window.localStorage.clear();
  });

  it("shows Copy failed when the clipboard API is missing or throws synchronously", () => {
    window.localStorage.clear();
    render(<Harness isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Retrieval details" })[0]);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Copy chunk ID" })[0]);
    expect(screen.getByText("Copy failed")).toBeInTheDocument();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => {
          throw new Error("sync");
        },
      },
      configurable: true,
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Copy chunk ID" })[0]);
    expect(screen.getByText("Copy failed")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).toBeNull();
    window.localStorage.clear();
  });

  it("gives the copy button a hit area of at least 32px", () => {
    window.localStorage.clear();
    render(<Harness isAdmin />);
    fireEvent.click(screen.getAllByRole("button", { name: "Retrieval details" })[0]);
    expect(screen.getAllByRole("button", { name: "Copy chunk ID" })[0].className).toContain(
      "before:-inset-2",
    );
    window.localStorage.clear();
  });

  it("shows the retrieved footer to admins", () => {
    render(<Harness isAdmin />);
    fireEvent.click(screen.getByRole("tab", { name: /Retrieved/ }));
    expect(screen.getByText("0.991")).toBeInTheDocument();
    expect(screen.getByText(/Rerank score · floor 0.05/)).toBeInTheDocument();
  });

  it("marks only the relied-on span and opens the document", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    expect(within(passageRow(1)).getByText("sixteen weeks of fully paid leave", { exact: false }).tagName).toBe("MARK");
    fireEvent.click(within(passageRow(2)).getByRole("button", { name: /Open document/ }));
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it("renders a passage skeleton while loading and a close button", () => {
    const onClose = vi.fn();
    render(
      <CitationLinkProvider>
        <EvidencePanel
          cited={[]}
          isAdmin={false}
          loading
          onClose={onClose}
          onOpenDocument={() => {}}
          onTabChange={() => {}}
          retrieved={[]}
          tab="cited"
        />
      </CitationLinkProvider>,
    );
    expect(screen.getAllByText("Loading passage").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
    expect(onClose).toHaveBeenCalled();
  });
});

const doc: ReaderDocumentView = {
  title: "Parental Leave Policy",
  version: "2.0",
  effective: "1 Feb 2026",
  readableBy: { label: "Everyone", everyone: true },
  owner: "HR",
  sections: [
    {
      heading: "Overview and Eligibility",
      paragraphs: [[{ text: "Northwind offers paid leave. " }, { text: "Eligible after six months.", citation: 2 }]],
    },
    {
      heading: "Paid Leave Duration",
      paragraphs: [[{ text: "You get " }, { text: "sixteen weeks", citation: 1 }, { text: " of leave." }]],
    },
  ],
};

describe("DocumentReader", () => {
  it("renders metadata, sections and highlights the active span strongly", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <CitationLinkProvider>
        <DocumentReader activeN={1} doc={doc} onBack={() => {}} onClose={() => {}} onOpenInLibrary={() => {}} />
      </CitationLinkProvider>,
    );
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("2.0")).toBeInTheDocument();
    expect(screen.getByText("Everyone")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paid Leave Duration" })).toBeInTheDocument();
    expect(screen.getByText("sixteen weeks").closest("mark")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Eligible after six months.").closest("mark")).not.toHaveAttribute("data-active");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("wires back, open in Library and close", () => {
    const [onBack, onClose, onLib] = [vi.fn(), vi.fn(), vi.fn()];
    render(
      <CitationLinkProvider>
        <DocumentReader activeN={null} doc={doc} onBack={onBack} onClose={onClose} onOpenInLibrary={onLib} />
      </CitationLinkProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Library" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect([onBack, onLib, onClose].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
});

