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
