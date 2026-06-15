"use server";

/**
 * Phase 10 — Estimate actions. Markup percentages live one-row-per-project in
 * `estimates`; totals are always computed live from line_items on the client.
 */
import { createClient } from "@/lib/supabase/server";

export type Markups = {
  contingency_pct: number;
  insurance_pct: number;
  overhead_pct: number;
  profit_pct: number;
};

export async function saveMarkups(
  projectId: string,
  markups: Markups,
  buildingSf?: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Percentages: keep sane (0–100); formulas are evaluated client-side.
  const clean: Record<string, number> = {};
  for (const k of [
    "contingency_pct",
    "insurance_pct",
    "overhead_pct",
    "profit_pct",
  ] as const) {
    const v = markups[k];
    if (!Number.isFinite(v) || v < 0 || v > 100)
      return { ok: false, error: "Markups must be between 0 and 100 percent." };
    clean[k] = v;
  }

  const row: Record<string, unknown> = {
    project_id: projectId,
    owner_id: user.id,
    ...clean,
    updated_at: new Date().toISOString(),
  };
  if (buildingSf !== undefined) row.building_sf = buildingSf;

  const { error } = await supabase
    .from("estimates")
    .upsert(row, { onConflict: "project_id" });
  if (error)
    return {
      ok: false,
      error:
        "Could not save markups. (Has migration 0013 been run in Supabase?)",
    };
  return { ok: true };
}
