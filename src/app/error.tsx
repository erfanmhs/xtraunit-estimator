"use client";

/**
 * Error boundary for the app's pages. Next.js renders this instead of a raw
 * crash screen when a Server/Client Component under the root layout throws.
 * "reset" re-renders the segment so the user can retry without a full reload.
 *
 * Every unhandled page error passes through the effect below, which reports it
 * to Sentry (a no-op until NEXT_PUBLIC_SENTRY_DSN is set).
 */
import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl glass p-8 text-center">
        <h1 className="font-heading text-2xl text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted">
          A hiccup on our side — your work isn&apos;t lost. Try again, and if it
          keeps happening, send Erfan this code so it can be traced.
        </p>
        {error.digest ? (
          <p className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-muted">
            {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
          >
            Try again
          </button>
          <Link
            href="/projects"
            className="rounded-md border border-border px-4 py-2.5 text-sm text-foreground transition-colors hover:border-brand hover:text-brand-soft"
          >
            Back to projects
          </Link>
        </div>
      </div>
    </div>
  );
}
