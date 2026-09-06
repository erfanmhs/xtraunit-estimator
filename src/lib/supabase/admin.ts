import "server-only";

/**
 * Supabase ADMIN client — the service-role key, which bypasses row-level
 * security. Server only, and used for exactly one thing: the background job
 * worker, which has to finish (or resume) a user's AI run after their login
 * token is gone — e.g. after a deploy. Every query the worker runs is scoped
 * to the job's own project_id / owner_id.
 *
 * The key comes from SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API).
 * Never expose it to the browser; never log it. With no key set, the queue
 * stays off and jobs run the old in-process way.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function hasServiceRole(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  if (!cached) {
    cached = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
