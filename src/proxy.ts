/**
 * The gatekeeper (Next.js 16 "proxy" convention — formerly "middleware").
 * Next.js runs this before every matching request. It delegates to
 * updateSession(), which refreshes the login and redirects signed-out
 * visitors to /login.
 *
 * The matcher below skips Next.js internals and static files (images, the
 * logo, favicon) so those load on the login page without requiring a login.
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
