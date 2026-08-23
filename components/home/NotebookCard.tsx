"use client";

import Link from "next/link";
import { formatDateTime, formatPageCount } from "@/lib/format";
import type { Survey } from "@/lib/models/types";

export function NotebookCard({
  survey,
  thumbUrl,
  onOpen,
  onMenu,
}: {
  survey: Survey;
  thumbUrl?: string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  return (
    <article className="notebook-card">
      <Link
        href={`/survey/${survey.id}`}
        className="notebook-card-open"
        onClick={onOpen}
      >
        <div className="notebook-thumb" style={{ background: "#fdfbf6" }}>
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] text-ink/35">vuota</span>
          )}
          <span
            className="notebook-thumb-spine"
            style={{ background: survey.coverColor }}
            aria-hidden
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="notebook-tag">VCAD</span>
          <h2 className="mt-1.5 truncate font-serif text-[1.05rem] font-semibold leading-tight text-ink">
            {survey.title}
          </h2>
          <p className="mt-0.5 text-xs text-ink/55">
            {formatDateTime(survey.updatedAt)} · {formatPageCount(survey.pages.length)}
          </p>
        </div>
      </Link>

      <button
        type="button"
        className="notebook-more"
        aria-label="Altre azioni sul taccuino"
        onClick={onMenu}
      >
        <IconDots />
      </button>
    </article>
  );
}

function IconDots() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
