import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CitationChip } from "./citation-chip";
import { Field, SearchField } from "./field";
import { Segmented } from "./segmented";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
  TableRowActions,
} from "./table";

const options = [
  { value: "cited", label: "Cited" },
  { value: "retrieved", label: "Retrieved" },
];

function Radios({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("cited");
  return (
    <Segmented
      label="Evidence view"
      mode="radiogroup"
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={options}
      value={value}
    />
  );
}

describe("Segmented", () => {
  it("radiogroup mode uses radio roles with aria-checked", () => {
    render(<Radios />);
    expect(screen.getByRole("radiogroup", { name: "Evidence view" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cited" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Retrieved" })).toHaveAttribute("aria-checked", "false");
  });

  it("selects on click and moves with arrow keys", () => {
    const onChange = vi.fn();
    render(<Radios onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Retrieved" }));
    expect(onChange).toHaveBeenLastCalledWith("retrieved");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Retrieved" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("cited");
  });

  it("tablist mode uses tab roles with aria-selected", () => {
    render(<Segmented label="Evidence" mode="tablist" onChange={() => {}} options={options} value="retrieved" />);
    expect(screen.getByRole("tablist", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Retrieved" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Cited" })).toHaveAttribute("aria-selected", "false");
  });

  it("only the selected option is in the tab order", () => {
    render(<Radios />);
    expect(screen.getByRole("radio", { name: "Cited" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Retrieved" })).toHaveAttribute("tabindex", "-1");
  });
});

describe("Segmented extras", () => {
  it("keeps one tab stop when the value matches nothing and skips a disabled first option", () => {
    render(
      <Segmented
        label="x"
        onChange={() => {}}
        options={[
          { value: "a", label: "A", disabled: true },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ]}
        value="none"
      />,
    );
    const stops = screen.getAllByRole("radio").filter((r) => r.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("B");
  });

  it("Home and End jump to the first and last enabled option", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="x"
        onChange={onChange}
        options={[
          { value: "a", label: "A", disabled: true },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
          { value: "d", label: "D", disabled: true },
        ]}
        value="b"
      />,
    );
    const b = screen.getByRole("radio", { name: "B" });
    fireEvent.keyDown(b, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(b, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("b");
  });
});

describe("CitationChip caller handlers", () => {
  it("chains caller focus and mouse handlers with onHover", () => {
    const onFocus = vi.fn();
    const onMouseEnter = vi.fn();
    const onHover = vi.fn();
    render(<CitationChip n={1} onFocus={onFocus} onHover={onHover} onMouseEnter={onMouseEnter} />);
    const chip = screen.getByRole("button", { name: "Citation 1" });
    fireEvent.focus(chip);
    fireEvent.mouseEnter(chip);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onHover).toHaveBeenCalledWith(true);
  });
});

describe("Field describedby", () => {
  it("merges a caller aria-describedby with the error id", () => {
    render(<Field aria-describedby="hint" error="Bad" label="Name" />);
    const input = screen.getByLabelText("Name");
    const ids = input.getAttribute("aria-describedby")?.split(" ");
    expect(ids?.[0]).toBe("hint");
    expect(ids).toHaveLength(2);
  });
});

describe("Field", () => {
  it("links the label to the input", () => {
    render(<Field label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("links the error message with aria-describedby and marks invalid", () => {
    render(<Field label="Email" error="Use your Northwind email." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const message = screen.getByText("Use your Northwind email.");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("disables the input", () => {
    render(<Field label="Email" disabled />);
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });
});

describe("SearchField", () => {
  it("shows a clear button only when there is a value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchField label="Search titles" onChange={onChange} value="" />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    rerender(<SearchField label="Search titles" onChange={onChange} value="leave" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("TableCell", () => {
  it("exposes the full text via title, with an explicit override", () => {
    render(
      <Table columns="1fr" label="t">
        <TableRow>
          <TableCell>Long text</TableCell>
          <TableCell title="Full">short</TableCell>
        </TableRow>
      </Table>,
    );
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveAttribute("title", "Long text");
    expect(cells[1]).toHaveAttribute("title", "Full");
  });
});

describe("Table", () => {
  it("renders table, header, rows and cells with roles", () => {
    render(
      <Table columns="1fr 100px" label="Documents">
        <TableHeaderRow>
          <TableHead>Document</TableHead>
          <TableHead>Department</TableHead>
        </TableHeaderRow>
        <TableRow>
          <TableCell>Parental Leave Policy</TableCell>
          <TableCell>HR</TableCell>
          <TableRowActions>
            <button type="button">Ask about this</button>
          </TableRowActions>
        </TableRow>
      </Table>,
    );
    expect(screen.getByRole("table", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Document" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Parental Leave Policy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask about this" })).toBeInTheDocument();
  });
});
