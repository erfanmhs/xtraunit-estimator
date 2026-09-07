"use client";

/**
 * Error screen for the takeoff viewer. When something in the viewer throws,
 * Next.js shows this instead of taking the whole app down. It reports to
 * Sentry (no-op until NEXT_PUBLIC_SENTRY_DSN is set), shows the actual
 * message so it can be relayed word for word, and offers a one-tap reload
 * that keeps you on the same sheet.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function ViewerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  const details = [
    `Message: ${error.message || "(none)"}`,
    error.digest ? `Digest: ${error.digest}` : null,
    `Page: ${typeof window !== "undefined" ? window.location.pathname : ""}`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
    error.stack ? `Stack: ${error.stack.split("\n").slice(0, 6).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="glass w-full max-w-md rounded-xl p-6 text-center">
        <h1 className="font-heading text-xl text-foreground">The viewer hit an error</h1>
        <p className="mt-2 text-sm text-muted">
          Your measurements are saved as you draw, so nothing is lost. Reload
          to pick up where you were. If it keeps happening, copy the details
          and send them to Erfan.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-background p-2.5 text-left text-[11px] leading-relaxed text-muted whitespace-pre-wrap break-words">
          {error.message || "(no message)"}
          {error.digest ? `\n${error.digest}` : ""}
        </pre>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
          >
            Reload the viewer
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(details);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="min-h-11 rounded-md border border-border px-4 text-sm text-foreground hover:border-brand"
          >
            {copied ? "Copied" : "Copy details"}
          </button>
          <Link
            href="/projects"
            className="min-h-11 rounded-md border border-border px-4 text-sm leading-[2.75rem] text-muted hover:text-foreground"
          >
            Projects
          </Link>
        </div>
      </div>
    </div>
  );
}
