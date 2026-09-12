/**
 * What the AI has cost on one project: the total, and the runs that made it.
 *
 * Every AI job (scope draft + review, apply findings, pricing suggestions)
 * records its own cost on its `scope_runs` row when it finishes — token counts
 * from Anthropic times the model's list price per million tokens, cache
 * tokens at their cheaper rate (see src/lib/ai-meter.ts). This just reads
 * those rows back. Nothing is estimated here.
 *
 * Runs from before migration 0032 carry no cost; they are listed with a dash
 * so the count of runs is honest even where the money is unknown.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AiRun = {
  id: string;
  kind: string | null; // 'scope' | 'apply' | 'pricing' | …
  status: string | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  ai_calls: number | null;
  created_at: string;
  finished_at: string | null;
};

export type AiSpend = {
  totalUsd: number;
  /** Runs that recorded a cost. */
  costedRuns: number;
  /** Runs with no cost on record (pre-0032, or still running / failed early). */
  uncostedRuns: number;
  runs: AiRun[];
};

export async function getAiSpend(sb: SupabaseClient, projectId: string): Promise<AiSpend | null> {
  const { data, error } = await sb
    .from("scope_runs")
    .select("id,kind,status,cost_usd,tokens_in,tokens_out,ai_calls,created_at,finished_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  // Older databases (no `kind` / cost columns) just get no section.
  if (error) return null;
  const runs = ((data ?? []) as unknown as AiRun[]).map((r) => ({
    ...r,
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
  }));
  let totalUsd = 0;
  let costedRuns = 0;
  let uncostedRuns = 0;
  for (const r of runs) {
    if (r.cost_usd == null) uncostedRuns += 1;
    else {
      totalUsd += r.cost_usd;
      costedRuns += 1;
    }
  }
  return { totalUsd, costedRuns, uncostedRuns, runs };
}
