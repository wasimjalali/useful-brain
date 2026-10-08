"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ProofStage } from "@/components/auth/proof-stage";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { UsefulBrainLogo } from "@/components/useful-brain-logo";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";

const INVALID = "This invite link is no longer valid.";

export function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(typeof payload?.message === "string" ? payload.message : INVALID);
        setPending(false);
        return;
      }
      router.push("/chat");
      router.refresh();
    } catch {
      setError(INVALID);
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 bg-canvas">
      <div className="flex w-full shrink-0 flex-col px-6 pb-8 pt-9 sm:px-[72px] lg:w-[560px]">
        <UsefulBrainLogo />
        <div className="flex max-w-[376px] flex-1 flex-col justify-center gap-7 py-10">
          <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-ink">
            Create your account
          </h1>
          <form
            className="flex flex-col gap-3 [&_.ub-field:not(:focus-within):not([data-invalid=true])]:bg-bubble [&_.ub-field:not(:focus-within):not([data-invalid=true])]:shadow-[0_0_0_1px_var(--edge),var(--lift)]"
            noValidate
            onSubmit={onSubmit}
          >
            <Field
              autoComplete="name"
              label="Name"
              name="name"
              onChange={(event) => setName(event.target.value)}
              required
              size={44}
              value={name}
            />
            <Field
              autoComplete="new-password"
              error={error ?? undefined}
              label="Password"
              minLength={8}
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
            <Button disabled={pending} size={36} style={{ height: 44, marginTop: 4 }} type="submit" variant="primary">
              Create account
            </Button>
          </form>
        </div>
        <p className="text-xs text-ink-faint-text">{DEFAULT_USEFUL_BRAIN_CONFIG.companyName} Systems</p>
      </div>
      <ProofStage />
    </main>
  );
}
