"use client";

/**
 * The guide itself: a sheet that slides up from the bottom on a phone and in
 * from the right on a laptop. Shows the entry for the page you're on, with
 * the six-stage journey strip across the top so a first-time user can read
 * any stage ahead of getting there. Closes on the backdrop, the ×, or Escape.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { GUIDE, JOURNEY, guideHref, type GuideKey } from "@/lib/guide/content";

export default function GuidePanel({
  initialKey,
  projectId,
  pathname,
  onClose,
}: {
  initialKey: GuideKey;
  projectId: string | null;
  /** Where we are — a "Next" that would land on this same page reads in place instead. */
  pathname: string;
  onClose: () => void;
}) {
  const [key, setKey] = useState<GuideKey>(initialKey);
  const entry = GUIDE[key];
  const onJourney = JOURNEY.some((j) => j.key === key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rawNext = entry.next ? guideHref(entry.next.key, projectId) : null;
  const nextHref = rawNext && rawNext !== pathname ? rawNext : null;
  const rawHere = key !== initialKey ? guideHref(key, projectId) : null;
  const hereHref = rawHere && rawHere !== pathname ? rawHere : null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <button
        type="button"
        aria-label="Close the guide"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="glass-strong absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-border shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted">Guide</p>
            <h2 id="guide-title" className="font-heading text-xl text-foreground">
              {entry.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Journey strip — the six stages; the one you're reading is lit. */}
        <div className="border-y border-border px-3 py-2">
          <ol className="flex items-stretch gap-1 overflow-x-auto">
            {JOURNEY.map((j, i) => {
              const active = j.key === key;
              return (
                <li key={j.key} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setKey(j.key)}
                    aria-current={active ? "step" : undefined}
                    aria-label={`${j.label} — stage ${i + 1}`}
                    className={`flex w-full min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] leading-tight transition-colors ${
                      active ? "bg-brand/15 text-foreground" : "text-muted hover:bg-background hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                        active ? "bg-brand text-white" : "border border-border"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="truncate">{j.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-foreground">{entry.purpose}</p>

          <ol className="mt-4 flex flex-col gap-3">
            {entry.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[28px_1fr] gap-x-2">
                <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand-soft">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{s.do}</p>
                  {s.note ? <p className="mt-0.5 text-xs text-muted">{s.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-green-400">Done looks like</p>
            <p className="mt-0.5 text-sm text-foreground">{entry.done}</p>
          </div>

          {entry.tip ? (
            <p className="mt-3 text-xs text-muted">
              <span className="font-medium text-foreground">Tip · </span>
              {entry.tip}
            </p>
          ) : null}

          {!onJourney ? null : (
            <p className="mt-4 text-xs text-muted">
              Stage {JOURNEY.findIndex((j) => j.key === key) + 1} of {JOURNEY.length} ·{" "}
              {JOURNEY.map((j) => j.short).join(" → ")}
            </p>
          )}
        </div>

        {/* Footer: go there / next */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 pb-safe">
          {hereHref ? (
            <Link
              href={hereHref}
              onClick={onClose}
              className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:border-brand"
            >
              Open {entry.title.split(" · ")[0]}
            </Link>
          ) : (
            <span />
          )}
          {entry.next ? (
            nextHref ? (
              <Link
                href={nextHref}
                onClick={onClose}
                className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
              >
                Next: {entry.next.label} →
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setKey(entry.next!.key)}
                className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
              >
                Next: {entry.next.label} →
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
