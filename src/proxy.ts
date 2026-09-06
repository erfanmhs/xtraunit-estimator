/**
 * The gatekeeper (Next.js 16 "proxy" convention — formerly "middleware").
 * Next.js runs this before every matching request. Two jobs:
 *
 *  1. Session: delegate to updateSession(), which refreshes the login and
 *     redirects signed-out visitors to /login.
 *  2. Content-Security-Policy with a per-request NONCE. Only scripts carrying
 *     this request's nonce may run — an injected <script> (XSS) is dead on
 *     arrival. Next.js reads the nonce from the CSP header we put on the
 *     REQUEST and stamps it onto every script it emits, so nothing else in the
 *     app has to know about it. Inline styles stay allowed ('unsafe-inline'
 *     for style-src only): React's style props are server-rendered as style
 *     attributes, and the threat CSP guards against is script, not style.
 *
 * The matcher below skips Next.js internals and static files (images, the
 * logo, favicon) so those load on the login page without requiring a login.
 * It also skips /monitoring — the Sentry tunnel that browser error reports
 * are posted through — so a crash on the login page can still be reported.
 *
 * Escape hatch: CSP_REPORT_ONLY=true sends the policy as report-only (the
 * browser logs violations but blocks nothing) — for a first deploy, or if a
 * new library ever trips it. CSP_DISABLED=true turns it off entirely.
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  // The browser talks to Supabase directly (auth, storage uploads, realtime).
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseWs = supabase.replace(/^http/, "ws");
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic': scripts loaded BY a nonced script are trusted too
    // (how Next.js loads its chunks). Dev needs eval for React's debug stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Plan renders (blob:), thumbnails (data:), proposal reference photos (https:).
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    // pdf.js runs its parser in a module Worker.
    "worker-src 'self' blob:",
    `connect-src 'self' ${supabase} ${supabaseWs}${isDev ? " ws://localhost:* http://localhost:*" : ""}`.trim(),
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Mirrors X-Frame-Options: SAMEORIGIN (swap for the XtraUnit host when embedded).
    "frame-ancestors 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export async function proxy(request: NextRequest) {
  const disabled = process.env.CSP_DISABLED === "true";
  const headerName =
    process.env.CSP_REPORT_ONLY === "true"
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy";

  let csp: string | null = null;
  if (!disabled) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    csp = buildCsp(nonce);
    // On the REQUEST so Next.js can stamp the nonce onto its scripts…
    request.headers.set("x-nonce", nonce);
    request.headers.set("Content-Security-Policy", csp);
  }

  const response = await updateSession(request);

  // …and on the RESPONSE so the browser enforces it.
  if (csp) response.headers.set(headerName, csp);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|monitoring|favicon.ico|favicon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      // Prefetches don't render a page — no nonce needed, skip the work.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
