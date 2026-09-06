import "server-only";

/**
 * Per-job AI cost meter — the cap on what ONE run can spend.
 *
 * The daily/monthly caps (ai-usage.ts) count runs. This meters DOLLARS inside
 * a run, from the token usage Anthropic reports on every response, so a single
 * Generate that goes sideways (huge plan set, a retry storm, a prompt that
 * balloons) is stopped at a known ceiling instead of running to whatever it
 * costs. Default ceiling: $15 per job (a normal full-building scope is ~$3–6;
 * pricing ~$1–2). Override per host with AI_JOB_BUDGET_USD.
 *
 * How it plugs in — no parameters threaded through the code:
 *   runWithAiBudget({ label }, async () => { ...the job... })
 * opens a meter in AsyncLocalStorage; every AI call inside it (however deep,
 * including parallel chunks) calls
 *   assertAiBudget()              before  — refuses if the ceiling is reached
 *   recordAiUsage(model, usage)   after   — adds the call's cost, logs it
 * Outside any runWithAiBudget both are harmless no-ops (cost is still logged).
 *
 * Honest limit: the check is BEFORE each call, so a job can overshoot by at
 * most one call (bounded by that call's max_tokens — a few dollars at worst).
 *
 * Prices are list prices per million tokens; unknown models are billed at the
 * Opus rate on purpose (over-count, never under-count). Keep in step with
 * src/config/ai.ts when models change.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

export const AI_JOB_BUDGET_USD = Number(process.env.AI_JOB_BUDGET_USD ?? 15);

type Price = { in: number; out: number; cacheWrite: number; cacheRead: number };
const PER_MTOK: { match: string; price: Price }[] = [
  { match: "opus", price: { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: "sonnet", price: { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { match: "haiku", price: { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
];
const FALLBACK = PER_MTOK[0].price;

export function priceFor(model: string): Price {
  const m = model.toLowerCase();
  return PER_MTOK.find((p) => m.includes(p.match))?.price ?? FALLBACK;
}

/** The usage shape every Anthropic message response carries (fields may be null). */
export type AiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function estimateCostUsd(model: string, u: AiUsage): number {
  const p = priceFor(model);
  const n = (x: number | null | undefined) => x ?? 0;
  return (
    (n(u.input_tokens) * p.in +
      n(u.output_tokens) * p.out +
      n(u.cache_creation_input_tokens) * p.cacheWrite +
      n(u.cache_read_input_tokens) * p.cacheRead) /
    1_000_000
  );
}

export class AiBudgetExceededError extends Error {
  constructor(public spentUsd: number, public budgetUsd: number) {
    super(
      `This run reached its AI spending limit ($${spentUsd.toFixed(2)} of a $${budgetUsd.toFixed(
        0,
      )} cap per run). That's a safety cap on cost — nothing is broken. Try a smaller run (specific trades instead of the full building), or raise AI_JOB_BUDGET_USD if this size is expected.`,
    );
    this.name = "AiBudgetExceededError";
  }
}

export type AiMeter = {
  label: string;
  budgetUsd: number;
  spentUsd: number;
  calls: number;
  tokensIn: number; // input + cache write + cache read
  tokensOut: number;
};

const als = new AsyncLocalStorage<AiMeter>();

/** Run `fn` with a fresh dollar meter that every AI call inside it reports to. */
export async function runWithAiBudget<T>(
  opts: { label: string; budgetUsd?: number },
  fn: (meter: AiMeter) => Promise<T>,
): Promise<T> {
  const meter: AiMeter = {
    label: opts.label,
    budgetUsd: opts.budgetUsd ?? AI_JOB_BUDGET_USD,
    spentUsd: 0,
    calls: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
  return als.run(meter, () => fn(meter));
}

/** The meter of the job we're inside, or null when not inside one. */
export function getAiMeter(): AiMeter | null {
  return als.getStore() ?? null;
}

/** True once the current job has hit its ceiling (false outside a job). */
export function aiBudgetExhausted(): boolean {
  const m = getAiMeter();
  return !!m && m.budgetUsd > 0 && m.spentUsd >= m.budgetUsd;
}

/** Call BEFORE each AI request. Throws AiBudgetExceededError at the ceiling. */
export function assertAiBudget(): void {
  const m = getAiMeter();
  if (m && m.budgetUsd > 0 && m.spentUsd >= m.budgetUsd) {
    log.warn("ai.budget.exceeded", {
      label: m.label,
      spentUsd: round(m.spentUsd),
      budgetUsd: m.budgetUsd,
      calls: m.calls,
    });
    throw new AiBudgetExceededError(m.spentUsd, m.budgetUsd);
  }
}

/** Call AFTER each AI response with the model + its `usage`. Logs the cost. */
export function recordAiUsage(model: string, usage: AiUsage | null | undefined, what?: string): number {
  const u = usage ?? {};
  const cost = estimateCostUsd(model, u);
  const m = getAiMeter();
  if (m) {
    m.spentUsd += cost;
    m.calls += 1;
    m.tokensIn +=
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0);
    m.tokensOut += u.output_tokens ?? 0;
  }
  log.info("ai.call", {
    label: m?.label,
    what,
    model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    costUsd: round(cost),
    jobSpentUsd: m ? round(m.spentUsd) : undefined,
  });
  return cost;
}

export function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

/** "~$3.42 AI" for status text; empty when nothing was spent. */
export function costLabel(m: AiMeter | null = getAiMeter()): string {
  if (!m || m.spentUsd <= 0) return "";
  return ` · ~$${m.spentUsd < 0.01 ? "0.01" : m.spentUsd.toFixed(2)} AI`;
}

/**
 * Persist the current job's spend on its scope_runs row. Best-effort: until
 * migration 0032 adds the columns the update fails quietly and nothing else
 * changes (the cap still works — it lives here, not in the DB).
 */
export async function saveRunCost(sb: SupabaseClient, runId: string): Promise<void> {
  const m = getAiMeter();
  if (!m || m.calls === 0) return;
  const { error } = await sb
    .from("scope_runs")
    .update({
      cost_usd: round(m.spentUsd),
      tokens_in: m.tokensIn,
      tokens_out: m.tokensOut,
      ai_calls: m.calls,
    })
    .eq("id", runId);
  if (error) log.debug("ai.cost.save_skipped", { runId, note: "is migration 0032 run?" });
  else log.info("ai.job.cost", { label: m.label, runId, costUsd: round(m.spentUsd), calls: m.calls });
}
