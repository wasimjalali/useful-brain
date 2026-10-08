import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthForm } from "@/components/auth/auth-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

describe("AuthForm", () => {
  it("shows the signup code field only on signup", () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByLabelText("Signup code")).toBeInTheDocument();
  });

  it("hides the signup code field on login", () => {
    render(<AuthForm mode="login" />);
    expect(screen.queryByLabelText("Signup code")).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in to Northwind" })).toBeInTheDocument();
  });

  it("toggles password visibility", () => {
    render(<AuthForm mode="login" />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("shows the server error under the password field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Wrong email or password." }), { status: 401 })),
    );
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Wrong email or password."),
    );
    expect(screen.getByLabelText("Password")).toBeInvalid();
  });

  it("announces a failed sign-in to screen readers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Wrong email or password." }), { status: 401 })),
    );
    render(<AuthForm mode="login" />);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Wrong email or password."),
    );
  });

  it("sends the signup code on signup", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "longenough" } });
    fireEvent.change(screen.getByLabelText("Signup code"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", password: "longenough", signupCode: "abc" });
  });
});
