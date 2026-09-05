/**
 * Sentry — EDGE runtime (src/proxy.ts runs here). Loaded by src/instrumentation.ts.
 * Same gating as the server config: no SENTRY_DSN → disabled, sends nothing.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: false,
});
