/**
 * Sentry — BROWSER. Next.js runs this file before the app hydrates, so client
 * crashes (and the error screens' captureException calls) are reported.
 *
 * Off until NEXT_PUBLIC_SENTRY_DSN is set. The DSN is a public "where to send
 * reports" address, not a secret — that's why this one is NEXT_PUBLIC_.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: false,
});

// Breadcrumbs for in-app navigation, so an error report shows the pages the
// user went through before it happened.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// A tab left open across a deploy can no longer fetch the OLD build's code
// chunks (Render replaces them), and the next lazy load throws a chunk error
// into the error screen. Reload once instead — the new build loads cleanly.
// Once per page life (sessionStorage flag, cleared after a clean 30 s) so a
// genuinely broken build can't loop.
if (typeof window !== "undefined") {
  const KEY = "xu:chunk-reload";
  const isChunkError = (msg: string) =>
    /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      msg,
    );
  const reloadOnce = () => {
    try {
      if (sessionStorage.getItem(KEY)) return; // already tried once this session
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  };
  window.addEventListener("error", (e) => {
    if (isChunkError(e.message || String(e.error?.message ?? ""))) reloadOnce();
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; name?: string } | undefined;
    if (isChunkError(`${r?.name ?? ""} ${r?.message ?? ""}`)) reloadOnce();
  });
  // A page that stays up for 30 s after a reload is healthy: allow one more.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  }, 30_000);
}
