import Image from "next/image";

import { UsefulBrainLogo } from "@/components/useful-brain-logo";
import {
  campaignRun,
  formatPassRate,
  NORTHWIND_CAMPAIGN,
} from "@/lib/eval/campaign-snapshot";
import { OPEN_BOOK_HREF, OPEN_BOOK_LABEL, OPEN_BUILD_HREF } from "@/lib/open-site";

const latest = campaignRun(NORTHWIND_CAMPAIGN.latestKey);

const SHOTS = [
  {
    src: "/open/chat.png",
    alt: "Useful Brain chat with a cited answer and the evidence inspector open.",
    title: "Chat",
    body: "Every factual answer cites the retrieved chunk. Missing evidence is a refusal, not a guess.",
  },
  {
    src: "/open/sources.png",
    alt: "Useful Brain Sources inventory with the operator corpus and document list.",
    title: "Sources",
    body: "The operator corpus stays visible. Promotion is an explicit step, so a failed draft cannot change retrieval.",
  },
  {
    src: "/open/evals.png",
    alt: "Useful Brain Evals dashboard for the locked Northwind campaign.",
    title: "Evals",
    body: `Locked Northwind run: ${latest.passed}/${latest.scored}, ${formatPassRate(latest.passRate)}. ${NORTHWIND_CAMPAIGN.documents} documents, ${NORTHWIND_CAMPAIGN.questions} questions.`,
  },
] as const;

export function OpenLanding() {
  return (
    <div className="min-h-full bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-transparent bg-canvas/90">
        <div className="mx-auto flex h-[72px] max-w-[1248px] items-center justify-between gap-6 px-6">
          <UsefulBrainLogo />
          <a className="btn btn-primary min-h-10 px-3 text-sm" href={OPEN_BOOK_HREF}>
            {OPEN_BOOK_LABEL}
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[1248px] px-6 py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-[16em] text-[2.5rem] font-medium leading-[1.02] tracking-[-0.042em] text-ink sm:text-[4rem]">
            Answers only from evidence you can inspect.
          </h1>
          <p className="mx-auto mt-6 max-w-[52ch] text-[18px] leading-[1.55] text-ink-muted">
            Useful Brain is a company knowledge agent. It retrieves documents
            the operator may read, cites every factual answer, and refuses when
            the corpus does not support the claim.
          </p>
          <p className="mx-auto mt-3 max-w-[52ch] text-[18px] leading-[1.55] text-ink-muted">
            Useful Build builds, customizes, and maintains this for companies.
          </p>
          <a
            className="btn btn-primary mt-9 inline-flex min-h-[52px] px-6 text-base"
            href={OPEN_BOOK_HREF}
          >
            {OPEN_BOOK_LABEL}
          </a>
        </section>

        {SHOTS.map((shot) => (
          <section className="mx-auto max-w-[1248px] px-6 pt-16 last:pb-24" key={shot.title}>
            <div className="mb-5 max-w-xl">
              <h2 className="text-[28px] font-medium tracking-[-0.03em] text-ink">
                {shot.title}
              </h2>
              <p className="mt-2 text-[16.5px] leading-[1.55] text-ink-muted">
                {shot.body}
              </p>
            </div>
            <figure className="overflow-visible rounded-none border border-border-strong bg-surface">
              <Image
                alt={shot.alt}
                className="block h-auto w-full"
                height={900}
                src={shot.src}
                width={1440}
              />
            </figure>
          </section>
        ))}
      </main>

      <footer className="mt-20 border-t border-border">
        <div className="mx-auto flex max-w-[1248px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-ink-muted">
          <p>
            A{" "}
            <a className="text-ink underline-offset-2 hover:underline" href={OPEN_BUILD_HREF}>
              Useful Build
            </a>{" "}
            product.
          </p>
          <a className="btn btn-primary min-h-10 px-3" href={OPEN_BOOK_HREF}>
            {OPEN_BOOK_LABEL}
          </a>
        </div>
      </footer>
    </div>
  );
}
