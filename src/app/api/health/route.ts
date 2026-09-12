/**
 * GET /api/health — is the app up, and can it reach its database?
 *
 * For the uptime monitor (UptimeRobot, every 5 min) and Render's own health
 * check. Public on purpose: it carries no data, only "ok" or not. A 200 means
 * the app answered AND a real query reached Supabase; a 503 means the app is
 * up but the database is not, which is exactly the case a login-page ping
 * would miss.
 *
 * The query is deliberately tiny and RLS-safe: a HEAD count on `profiles`
 * with the anon key returns 0 rows for a signed-out caller, but it still
 * has to round-trip to Postgres to say so.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const started = Date.now();
  let db: "ok" | "error" = "error";
  let detail: string | undefined;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase env vars missing");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const { error } = await sb
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .abortSignal(ctl.signal);
    clearTimeout(timer);
    if (error) throw error;
    db = "ok";
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  const body = {
    ok: db === "ok",
    db,
    ...(detail ? { detail } : {}),
    latencyMs: Date.now() - started,
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? process.env.npm_package_version ?? "dev",
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: body.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
