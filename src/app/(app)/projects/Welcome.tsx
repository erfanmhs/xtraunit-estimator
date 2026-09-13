"use client";

/**
 * The first thing a new user sees: the whole journey in six lines and one
 * button. Replaces the bare "No projects yet" box. "Show me around" opens
 * the Guide (the "?" in the corner) so they learn where it lives.
 */
import Link from "next/link";
import { JOURNEY } from "@/lib/guide/content";

export default function Welcome() {
  return (
    <div className="mx-auto max-w-2xl rounded-xl panel p-6 sm:p-8">
      <p className="text-[11px] uppercase tracking-wider text-brand-soft">Welcome</p>
      <h2 className="mt-1 font-heading text-2xl text-foreground">From plans to a signed proposal, in six steps</h2>
      <p className="mt-2 text-sm text-muted">
        Upload the plans, measure a handful of things, and the AI writes the scope, suggests the
        prices and drafts the proposal. You confirm every number before a client sees it.
      </p>

      <ol className="mt-5 grid gap-2 sm:grid-cols-2">
        {JOURNEY.map((j, i) => (
          <li key={j.key} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand-soft">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{j.label}</p>
              <p className="text-xs text-muted">{j.short}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/projects/new"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          + Create your first project
        </Link>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("xu:guide"))}
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-brand"
        >
          Show me around
        </button>
        <p className="basis-full text-xs text-muted sm:basis-auto">
          The <span className="font-heading text-brand-soft">?</span> in the corner explains every page.
        </p>
      </div>
    </div>
  );
}
