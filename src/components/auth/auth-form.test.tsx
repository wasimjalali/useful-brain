import { describe, expect, it } from "vitest";

import { AuthForm } from "@/components/auth/auth-form";
import { render, screen } from "@testing-library/react";

describe("AuthForm", () => {
  it("shows the signup code field only on signup", () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByLabelText("Signup code")).toBeInTheDocument();
  });

  it("hides the signup code field on login", () => {
    render(<AuthForm mode="login" />);
    expect(screen.queryByLabelText("Signup code")).toBeNull();
  });
});
