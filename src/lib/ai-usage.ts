import "server-only";

/**
 * The guard on the Anthropic bill.
 *
 * Every action that spends AI tokens calls enforceAiLimit() first. It applies
 * a short burst limit (rate-limit.ts), then counts the user's runs in a
 * rolling 24-hour and 30-day window and refuses if either cap is hit — so a
 * runaway loop, an over-eager user, or a stranger who signed up can't quietly
 * rack up API cost. Caps are generous for real solo use and tunable per host
 * via env (AI_DAILY_LIMIT / AI_MONTHLY_LIMIT; set 0 to disable a window).
 *
 * On top of the run counts there is a real DOLLAR budget per user per
 * rolling 30 days (AI_MONTHLY_BUDGET_USD, default $25; 0 disables). It is
 * the sum of what every finished job recorded on scope_runs.cost_usd plus
 * what every one-shot call settled on ai_usage.cost_usd (migration 0042).
 * The dollar ceiling INSIDE one run is a separate guard: ai-meter.ts.
 *
 * FAILS OPEN by design: if the ai_usage table is missing (migration 0027 not
 * run yet) or the DB hiccups, the user is NOT blocked — the cap simply isn't
 * enforced until the migration is applied. Running 0027 is what turns it on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { rateLimit, LIMITS } from "@/lib/rate-limit";

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 60);
const MONTHLY_LIMIT = Number(process.env.AI_MONTHLY_LIMIT ?? 600);
export const MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 25);
const DAY_MS = 24 * 60 * 60 * 1000;

type LimitResult =
  | { ok: true; usageId: string | null }
  | { ok: false; error: string };

export type AiSpendMonth = {
  spentUsd: number;
  budgetUsd: number; // 0 = no dollar budget
  /** 0–1 of the budget used (0 when there is no budget). */
  fraction: number;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * What this user has spent on AI in the last 30 days: finished jobs
 * (scope_runs.cost_usd) plus settled one-shot calls (ai_usage.cost_usd).
 * Either table missing its column just contributes nothing.
 */
export async function getAiSpendThisMonth(sb: SupabaseClient, userId: string): Promise<AiSpendMonth> {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  let spent = 0;
  const jobs = await sb
    .from("scope_runs")
    .select("cost_usd")
    .eq("owner_id", userId)
    .gte("created_at", since)
    .not("cost_usd", "is", null);
  if (!jobs.error) for (const r of jobs.data ?? []) spent += Number((r as { cost_usd: number | string }).cost_usd);
  const calls = await sb
    .from("ai_usage")
    .select("cost_usd")
    .eq("owner_id", userId)
    .gte("created_at", since)
    .not("cost_usd", "is", null);
  if (!calls.error) for (const r of calls.data ?? []) spent += Number((r as { cost_usd: number | string }).cost_usd);
  const budget = MONTHLY_BUDGET_USD > 0 ? MONTHLY_BUDGET_USD : 0;
  return { spentUsd: spent, budgetUsd: budget, fraction: budget > 0 ? spent / budget : 0 };
}

/**
 * After a one-shot AI call (not a job): write what it cost onto the
 * ai_usage row enforceAiLimit created. Best-effort — the work is done; a
 * failed settle only means this call is missing from the month's total.
 */
export async function settleAiUsage(
  sb: SupabaseClient,
  usageId: string | null,
  costUsd: number,
): Promise<void> {
  if (!usageId) return;
  const { error } = await sb
    .from("ai_usage")
    .update({ cost_usd: Math.round(costUsd * 10_000) / 10_000 })
    .eq("id", usageId);
  if (error) log.warn("ai.usage.settle_failed", { usageId, note: "is migration 0042 run?", err: error });
}

export async function enforceAiLimit(
  sb: SupabaseClient,
  userId: string,
  kind: string,
): Promise<LimitResult> {
  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();

  // Burst guard first (in-memory, instant): stops a stuck retry loop or a
  // script hammering Generate long before the daily count would.
  const burst = rateLimit(`ai:${userId}`, LIMITS.aiBurst, "AI runs");
  if (!burst.ok) return { ok: false, error: burst.error };

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

    if (DAILY_LIMIT > 0 && (await countSince(since(DAY_MS))) >= DAILY_LIMIT) {
      log.warn("ai.cap.daily", { userId, kind, limit: DAILY_LIMIT });
      return {
        ok: false,
        error: `You've reached today's AI limit (${DAILY_LIMIT} runs). This is a safety cap on AI cost — it frees up over the next 24 hours, and the limit can be raised if this is expected usage.`,
      };
    }

    if (
      MONTHLY_LIMIT > 0 &&
      (await countSince(since(30 * DAY_MS))) >= MONTHLY_LIMIT
    ) {
      log.warn("ai.cap.monthly", { userId, kind, limit: MONTHLY_LIMIT });
      return {
        ok: false,
        error: `You've reached this month's AI limit (${MONTHLY_LIMIT} runs). The limit can be raised if this is expected usage.`,
      };
    }

    // The dollar budget — the one that actually protects the bill.
    if (MONTHLY_BUDGET_USD > 0) {
      const m = await getAiSpendThisMonth(sb, userId);
      if (m.spentUsd >= m.budgetUsd) {
        log.warn("ai.cap.budget", { userId, kind, spentUsd: m.spentUsd, budgetUsd: m.budgetUsd });
        return {
          ok: false,
          error: `You've used this month's AI budget (${usd(m.spentUsd)} of ${usd(m.budgetUsd)} in the last 30 days). It frees up as older runs age out, or the budget can be raised in the app's settings on Render (AI_MONTHLY_BUDGET_USD).`,
        };
      }
    }
  } catch (e) {
    // Table missing (migration 0027 pending) or a transient DB error → fail open.
    log.warn("ai.cap.skipped", { userId, kind, note: "is migration 0027 run?", err: e });
    return { ok: true, usageId: null };
  }

  // Record this run (best-effort — a failed insert must not block the work).
  // The row id comes back so a one-shot call can settle its cost onto it.
  const { data, error } = await sb
    .from("ai_usage")
    .insert({ owner_id: userId, kind })
    .select("id")
    .single();
  if (error) log.warn("ai.usage.record_failed", { userId, kind, err: error });
  return { ok: true, usageId: data?.id ?? null };
}
