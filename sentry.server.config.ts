/**
 * Sentry — SERVER (Node) runtime. Loaded once by src/instrumentation.ts.
 *
 * Off until SENTRY_DSN is set: with no DSN the SDK initializes in a disabled
 * state and sends nothing, so local dev and CI stay quiet.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Performance tracing: sample 10% of requests in production (cheap, still
  // enough to see slow pages). Set SENTRY_TRACES_SAMPLE_RATE to change.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // Don't send request bodies / user IPs by default — plans and estimates are
  // client data. Errors still carry the stack trace and route.
  sendDefaultPii: false,
});
