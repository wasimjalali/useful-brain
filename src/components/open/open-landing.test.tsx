import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OpenLanding } from "./open-landing";
import {
  OPEN_BOOK_HREF,
  OPEN_BOOK_LABEL,
  OPEN_GITHUB_HREF,
  OPEN_GITHUB_LABEL,
} from "@/lib/open-site";

describe("OpenLanding", () => {
  it("keeps a single audit action in the header and stacks product shots", () => {
    render(<OpenLanding />);

    const header = screen.getByRole("banner");
    expect(
      header.querySelector(`a[href="${OPEN_BOOK_HREF}"]`),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: OPEN_GITHUB_LABEL })).toHaveAttribute(
      "href",
      OPEN_GITHUB_HREF,
    );

    const audit = screen.getAllByRole("link", { name: OPEN_BOOK_LABEL });
    expect(audit.length).toBeGreaterThan(0);
    for (const link of audit) {
      expect(link).toHaveAttribute("href", OPEN_BOOK_HREF);
    }

    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evals" })).toBeInTheDocument();
    expect(screen.getByText(/114\/120/)).toBeInTheDocument();
  });
});
