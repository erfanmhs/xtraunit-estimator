import "server-only";

/**
 * The guard on the Anthropic bill.
 *
 * Every action that spends AI tokens calls enforceAiLimit() first. It counts
 * the user's runs in a rolling 24-hour and 30-day window and refuses if either
 * cap is hit — so a runaway loop, an over-eager user, or a stranger who signed
 * up can't quietly rack up API cost. Caps are generous for real solo use and
 * tunable per host via env (AI_DAILY_LIMIT / AI_MONTHLY_LIMIT; set 0 to disable
 * a window).
 *
 * FAILS OPEN by design: if the ai_usage table is missing (migration 0027 not
 * run yet) or the DB hiccups, the user is NOT blocked — the cap simply isn't
 * enforced until the migration is applied. Running 0027 is what turns it on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 60);
const MONTHLY_LIMIT = Number(process.env.AI_MONTHLY_LIMIT ?? 600);
const DAY_MS = 24 * 60 * 60 * 1000;

type LimitResult = { ok: true } | { ok: false; error: string };

export async function enforceAiLimit(
  sb: SupabaseClient,
  userId: string,
  kind: string,
): Promise<LimitResult> {
  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();

  try {
    const countSince = async (cutoff: string): Promise<number> => {
      const { count, error } = await sb
        .from("ai_usage")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .gte("created_at", cutoff);
      if (error) throw error;
      return count ?? 0;
    };

    if (DAILY_LIMIT > 0 && (await countSince(since(DAY_MS))) >= DAILY_LIMIT)
      return {
        ok: false,
        error: `You've reached today's AI limit (${DAILY_LIMIT} runs). This is a safety cap on AI cost — it frees up over the next 24 hours, and the limit can be raised if this is expected usage.`,
      };

    if (
      MONTHLY_LIMIT > 0 &&
      (await countSince(since(30 * DAY_MS))) >= MONTHLY_LIMIT
    )
      return {
        ok: false,
        error: `You've reached this month's AI limit (${MONTHLY_LIMIT} runs). The limit can be raised if this is expected usage.`,
      };
  } catch (e) {
    // Table missing (migration 0027 pending) or a transient DB error → fail open.
    console.error("ai-usage: cap check skipped (is migration 0027 run?):", e);
    return { ok: true };
  }

  // Record this run (best-effort — a failed insert must not block the work).
  const { error } = await sb.from("ai_usage").insert({ owner_id: userId, kind });
  if (error) console.error("ai-usage: could not record run:", error);
  return { ok: true };
}
