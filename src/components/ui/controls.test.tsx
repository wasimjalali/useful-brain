import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

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
