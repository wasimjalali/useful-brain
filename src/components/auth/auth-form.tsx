"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ProofStage } from "@/components/auth/proof-stage";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { UsefulBrainLogo } from "@/components/useful-brain-logo";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";

export function AuthForm({
  mode,
}: {
  mode: "login" | "signup";
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch(isSignup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isSignup ? { email, password, signupCode } : { email, password },
        ),
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

  const errorField: "password" | "signupCode" =
    isSignup && error && /code/i.test(error) ? "signupCode" : "password";
  const fieldError = (target: "email" | "password" | "signupCode") =>
    error && errorField === target ? error : undefined;

  return (
    <main className="flex min-h-full flex-1 bg-canvas">
      <div className="flex w-full shrink-0 flex-col px-6 pb-8 pt-9 sm:px-[72px] lg:w-[560px]">
        <UsefulBrainLogo />
        <div className="flex max-w-[376px] flex-1 flex-col justify-center gap-7 py-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-ink">
              {isSignup ? "Create your account" : `Sign in to ${DEFAULT_USEFUL_BRAIN_CONFIG.companyName}`}
            </h1>
            <p className="text-[15px] leading-6 text-ink-muted">
              Ask about company documents. Every answer shows the passage behind it.
            </p>
          </div>
          <form
            className="flex flex-col gap-3 [&_.ub-field:not(:focus-within):not([data-invalid=true])]:bg-bubble [&_.ub-field:not(:focus-within):not([data-invalid=true])]:shadow-[0_0_0_1px_var(--edge),var(--lift)]"
            noValidate
            onSubmit={onSubmit}
          >
            <Field
              autoComplete="email"
              error={fieldError("email")}
              label="Email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              size={44}
              type="email"
              value={email}
            />
            <Field
              autoComplete={isSignup ? "new-password" : "current-password"}
              error={fieldError("password")}
              label="Password"
              minLength={isSignup ? 8 : undefined}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              size={44}
              trailing={
                <IconButton
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </IconButton>
              }
              type={showPassword ? "text" : "password"}
              value={password}
            />
            {isSignup ? (
              <Field
                autoComplete="off"
                error={fieldError("signupCode")}
                label="Signup code"
                name="signupCode"
                onChange={(event) => setSignupCode(event.target.value)}
                size={44}
                type="password"
                value={signupCode}
              />
            ) : null}
            <p className="sr-only" role="alert">
              {error}
            </p>
            <Button disabled={pending} size={36} style={{ height: 44, marginTop: 4 }} type="submit" variant="primary">
              {isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="text-xs leading-[18px] text-ink-faint-text">
            You&apos;ll only see documents your department and role can read.
          </p>
          <p className="text-sm text-ink-muted">
            {isSignup ? (
              <Link className="text-ink underline" href="/login">
                Sign in
              </Link>
            ) : (
              <Link className="text-ink underline" href="/signup">
                Create account
              </Link>
            )}
          </p>
        </div>
        <p className="text-xs text-ink-faint-text">{DEFAULT_USEFUL_BRAIN_CONFIG.companyName} Systems</p>
      </div>
      <ProofStage />
    </main>
  );
}
