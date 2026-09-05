/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Loads the matching Sentry config for the runtime that's booting (Node for
 * pages/actions/jobs, Edge for src/proxy.ts), and reports every unhandled
 * server error (page render, route handler, server action, proxy) to Sentry
 * with its route and request info attached. All of it is a no-op without
 * SENTRY_DSN.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
