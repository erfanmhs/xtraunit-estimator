"use server";

/**
 * Cost Database browser — edit or remove entries in your price history.
 * Bad entries pollute future matching, so cleanup here matters.
 */
import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok: boolean; error?: string };

export type CostEntryPatch = {
  description?: string;
  unit?: string | null;
  price_mode?: string;
  cost_labor?: number | null;
  cost_material?: number | null;
  cost_sub?: number | null;
  cost_equipment?: number | null;
  cost_other?: number | null;
  cost_total?: number | null;
  price_note?: string | null;
};

export async function updateCostEntry(
  entryId: string,
  patch: CostEntryPatch,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (patch.description !== undefined && !patch.description.trim())
    return { ok: false, error: "Description can't be empty." };

  const { error } = await supabase
    .from("cost_database")
    .update(patch)
    .eq("id", entryId);
  if (error) return { ok: false, error: "Could not save the entry." };
  return { ok: true };
}

export async function deleteCostEntry(entryId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("cost_database")
    .delete()
    .eq("id", entryId);
  if (error) return { ok: false, error: "Could not delete the entry." };
  return { ok: true };
}
