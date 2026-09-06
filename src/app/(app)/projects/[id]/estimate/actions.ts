"use server";

/**
 * Phase 10 — Estimate actions. Markup percentages live one-row-per-project in
 * `estimates`; totals are always computed live from line_items on the client.
 */
import { createClient } from "@/lib/supabase/server";
import { uuid, markupsInput, buildingSfInput, firstIssue } from "@/lib/validation";

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
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "That project id isn't valid." };

  // Percentages: keep sane (0–100); formulas are evaluated client-side.
  const parsed = markupsInput.safeParse(markups);
  if (!parsed.success)
    return { ok: false, error: "Markups must be between 0 and 100 percent." };
  const sf = buildingSfInput.safeParse(buildingSf);
  if (!sf.success) return { ok: false, error: firstIssue(sf.error, "Building size isn't valid.") };

  const row: Record<string, unknown> = {
    project_id: projectId,
    owner_id: user.id,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };
  if (sf.data !== undefined) row.building_sf = sf.data;

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
