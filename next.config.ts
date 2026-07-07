import type { NextConfig } from "next";

/**
 * Security headers — sent on every response so the browser behaves more safely.
 * These are the "can't break anything" set. The stronger Content-Security-Policy
 * is deliberately deferred to its own tested step (it needs per-request nonces
 * to avoid white-screening the app).
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
};

export default nextConfig;
