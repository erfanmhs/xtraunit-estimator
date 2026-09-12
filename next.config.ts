import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * Security headers — sent on every response so the browser behaves more safely.
 * These are the static set. The Content-Security-Policy lives in src/proxy.ts
 * because it needs a fresh nonce per request.
 *
 * Note on X-Frame-Options: SAMEORIGIN blocks OTHER sites from embedding this app
 * in an iframe (clickjacking protection). The app isn't embedded anywhere today.
 * When it's embedded in the XtraUnit platform, swap this for a CSP
 * `frame-ancestors` that allows that specific host.
 */
const securityHeaders = [
  // Force HTTPS for ~180 days once the browser has seen the site over HTTPS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000; includeSubDomains",
  },
  // Don't let the browser guess a file's type (a known attack vector).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only this site may frame the app (anti-clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Send only the origin (not the full path) when navigating to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Turn off browser features the app doesn't use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      // The AI count check posts a sheet JPEG through a server action; the
      // default 1 MB cap is too tight for a dense drawing. The viewer keeps
      // the image under ~0.9 MB itself; this is the headroom.
      bodySizeLimit: "2mb",
    },
  },
};

/**
 * Error tracking (Sentry). withSentryConfig adds the build-time pieces: it
 * bundles the SDK config files and, ONLY when SENTRY_AUTH_TOKEN + SENTRY_ORG +
 * SENTRY_PROJECT are set, uploads source maps so stack traces show real file
 * names and lines. Without those env vars the upload is skipped and the build
 * is unchanged — so local dev and CI don't need a Sentry account.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Keep build output quiet unless something goes wrong.
  silent: !process.env.CI,
  // Don't phone home with build telemetry.
  telemetry: false,
  // Route browser reports through this app (/monitoring) so ad-blockers don't
  // drop them. Only matters once a DSN is set.
  tunnelRoute: "/monitoring",
  sourcemaps: {
    // Only upload when the credentials exist; otherwise skip silently.
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
