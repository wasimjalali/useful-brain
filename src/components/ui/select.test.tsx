import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";
import { Select } from "./select";

const options = [
  { label: "Operator", value: "operator" },
  { label: "Support", value: "support" },
  { label: "Finance", value: "finance" },
];

describe("Select", () => {
  it("moves with arrows and commits with Enter", () => {
    const onChange = vi.fn();
    render(
      <div>
        <label htmlFor="principal">Assume principal</label>
        <Select
          id="principal"
          onChange={onChange}
          options={options}
          value="operator"
        />
      </div>,
    );

    const combobox = screen.getByRole("combobox", { name: "Assume principal" });
    fireEvent.click(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    fireEvent.keyDown(combobox, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("support");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the menu on Escape without closing a parent dialog", () => {
    const onClose = vi.fn();
    render(
      <Dialog ariaLabel="Settings" maxWidth="max-w-lg" onClose={onClose}>
        <label htmlFor="principal">Assume principal</label>
        <Select
          id="principal"
          onChange={vi.fn()}
          options={options}
          value="operator"
        />
      </Dialog>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Assume principal" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });
});
