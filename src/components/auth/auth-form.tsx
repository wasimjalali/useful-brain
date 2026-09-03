"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { UsefulBrainLogo } from "@/components/useful-brain-logo";

export function AuthForm({
  mode,
}: {
  mode: "login" | "signup";
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch(isSignup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(typeof payload?.message === "string" ? payload.message : "The request could not be completed.");
        setPending(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("The request could not be completed.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-start bg-canvas px-6 py-16">
      <div className="w-full max-w-sm">
        <UsefulBrainLogo />
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.03em] text-ink">
          {isSignup ? "Create account" : "Log in"}
        </h1>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            Email
            <input
              autoComplete="email"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            Password
            <input
              autoComplete={isSignup ? "new-password" : "current-password"}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              minLength={isSignup ? 8 : undefined}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-ink disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {isSignup ? "Create account" : "Log in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-ink-muted">
          {isSignup ? (
            <Link className="text-ink underline" href="/login">
              Log in
            </Link>
          ) : (
            <Link className="text-ink underline" href="/signup">
              Create account
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
