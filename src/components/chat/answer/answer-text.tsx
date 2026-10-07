"use client";

import { Fragment } from "react";

import { CitationChip } from "@/components/ui/citation-chip";
import type { AnswerParagraphView } from "@/lib/contracts/chat-view";

import { useCitationBinding } from "../evidence/citation-link";

function LinkedChip({ n }: { n: number }) {
  const { active, onHover, onClick } = useCitationBinding(n);
  return <CitationChip active={active} n={n} onClick={onClick} onHover={onHover} />;
}

const MARKER = /\[(\d+)\]/g;

function Paragraph({ paragraph, muted }: { paragraph: AnswerParagraphView; muted: boolean }) {
  const valid = new Set(paragraph.citations);
  const parts = paragraph.text.split(MARKER);
  // split with one capture group alternates: text, number, text, number, ...
  const hasInline = parts.some((part, index) => index % 2 === 1 && valid.has(Number(part)));

  return (
    <p className={`m-0 text-[15px] leading-6 ${muted ? "text-ink-muted" : "text-ink"}`}>
      {parts.map((part, index) => {
        if (index % 2 === 0) {
          return <Fragment key={index}>{part}</Fragment>;
        }
        const n = Number(part);
        return valid.has(n) ? <LinkedChip key={index} n={n} /> : null;
      })}
      {hasInline
        ? null
        : paragraph.citations.map((n) => (
            <Fragment key={n}>
              {" "}
              <LinkedChip n={n} />
            </Fragment>
          ))}
    </p>
  );
}

/** Paragraphs with inline citation chips at validated [n] markers, else at paragraph end. */
export function AnswerText({
  paragraphs,
  muted = false,
}: {
  paragraphs: AnswerParagraphView[];
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 max-[767px]:[&_.ub-cite]:relative max-[767px]:[&_.ub-cite]:h-5 max-[767px]:[&_.ub-cite]:min-w-[22px] max-[767px]:[&_.ub-cite]:after:absolute max-[767px]:[&_.ub-cite]:after:-inset-3 max-[767px]:[&_.ub-cite]:after:content-['']">
      {paragraphs.map((paragraph, index) => (
        <Paragraph key={index} muted={muted} paragraph={paragraph} />
      ))}
    </div>
  );
}
