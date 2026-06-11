/**
 * Supabase client for the BROWSER (client components).
 *
 * Use this inside React components marked with "use client" — for example,
 * a login form or anything that needs the database while the user is clicking
 * around in their browser.
 *
 * It only uses the public URL and the public "anon" key, both of which are
 * safe to expose to the browser. Never put secret keys in this file.
 *
 * Credentials are read from environment variables (see .env.local.example).
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
