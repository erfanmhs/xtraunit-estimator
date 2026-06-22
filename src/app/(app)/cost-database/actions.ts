"use server";

/**
 * Cost Database browser — edit or remove entries in your price history.
 * Bad entries pollute future matching, so cleanup here matters.
 */
import { createClient } from "@/lib/supabase/server";
import {
  findOrCreateItem,
  recomputeItemStd,
  normKey,
} from "@/lib/scope/items";

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

// ── Pricing references (live on company_settings, shown on Cost Database) ────

export type Benchmark = {
  label: string;
  sell_low: number | null;
  sell_high: number | null;
};
export type UnitPrice = {
  item: string;
  unit: string;
  cost: number | null;
};
// Your own confirmed DIRECT cost per SF, by project type — computed live, shown
// next to the manual sell band as a reality check (direct cost, before markups).
export type ObservedBenchmark = {
  label: string;
  low: number;
  high: number;
  median: number;
  n: number;
};

async function saveSettingsColumn(
  column: "benchmarks" | "unit_prices",
  value: unknown,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("company_settings")
    .upsert(
      { owner_id: user.id, [column]: value, updated_at: new Date().toISOString() },
      { onConflict: "owner_id" },
    );
  if (error)
    return {
      ok: false,
      error: "Could not save. (Has migration 0019/0020 been run?)",
    };
  return { ok: true };
}

export async function saveBenchmarks(
  benchmarks: Benchmark[],
): Promise<ActionResult> {
  const clean = benchmarks.filter(
    (b) => b.label.trim() && (b.sell_low != null || b.sell_high != null),
  );
  return saveSettingsColumn("benchmarks", clean);
}

// Standard unit prices are no longer edited as a raw JSON list — the Cost items
// catalog (below) supersedes it. The unit_prices column is still read as a seed
// when first building the catalog, and as a fallback in the pricing AI.

// ── Cost items (the canonical catalog) ───────────────────────────────────────

export type CostItem = {
  id: string;
  division_code: string | null;
  section_code: string | null;
  name: string;
  unit: string | null;
  std_cost_override: number | null;
  std_cost_computed: number | null;
  std_count: number | null;
  last_observed: string | null;
};

/** Set or clear an item's manual override (null = fall back to the computed value). */
export async function setItemOverride(
  itemId: string,
  override: number | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("cost_items")
    .update({ std_cost_override: override })
    .eq("id", itemId);
  if (error) return { ok: false, error: "Could not save the price." };
  return { ok: true };
}

/** Rename an item (also refreshes its match key). */
export async function renameItem(
  itemId: string,
  name: string,
  unit: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!name.trim()) return { ok: false, error: "Name can't be empty." };
  const { error } = await supabase
    .from("cost_items")
    .update({ name: name.trim(), norm_key: normKey(name), unit: unit?.trim() || null })
    .eq("id", itemId);
  if (error) return { ok: false, error: "Could not rename the item." };
  return { ok: true };
}

/** Delete an item. Its observations stay in history (their link just clears). */
export async function deleteItem(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase.from("cost_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: "Could not delete the item." };
  return { ok: true };
}

/**
 * (Re)build the catalog from everything we know: group every price observation
 * that isn't linked yet into a canonical item, import any hand-typed standard
 * unit prices as override items, then refresh every item's standard price.
 * Safe to run repeatedly.
 */
export async function rebuildCatalogFromHistory(): Promise<
  { ok: boolean; items?: number; error?: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // 1) Group unlinked observations into items.
  const { data: obs, error: obsErr } = await supabase
    .from("cost_database")
    .select("id,item_id,division_code,section_code,description,unit")
    .is("item_id", null);
  if (obsErr)
    return { ok: false, error: "Could not read history. (Has migration 0021 been run?)" };

  const touched = new Set<string>();
  for (const o of obs ?? []) {
    const itemId = await findOrCreateItem(supabase, user.id, {
      division_code: o.division_code,
      section_code: o.section_code,
      description: o.description,
      unit: o.unit,
    });
    if (!itemId) continue;
    await supabase.from("cost_database").update({ item_id: itemId }).eq("id", o.id);
    touched.add(itemId);
  }

  // 2) Import hand-typed standard unit prices as manual override items
  //    (only ones we don't already have, by normalized name).
  const cs = await supabase
    .from("company_settings")
    .select("unit_prices")
    .maybeSingle();
  const legacy = (Array.isArray(cs.data?.unit_prices)
    ? cs.data.unit_prices
    : []) as UnitPrice[];
  if (legacy.length) {
    const { data: existing } = await supabase
      .from("cost_items")
      .select("norm_key")
      .eq("owner_id", user.id);
    const have = new Set((existing ?? []).map((e) => e.norm_key as string));
    for (const u of legacy) {
      if (!u.item?.trim() || u.cost == null) continue;
      const key = normKey(u.item);
      if (have.has(key)) continue;
      await supabase.from("cost_items").insert({
        owner_id: user.id,
        name: u.item.trim(),
        norm_key: key,
        unit: u.unit || "ea",
        std_cost_override: u.cost,
        aliases: [],
      });
      have.add(key);
    }
  }

  // 3) Refresh computed standards for the items we touched.
  for (const id of touched) await recomputeItemStd(supabase, id);

  const { count } = await supabase
    .from("cost_items")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  return { ok: true, items: count ?? undefined };
}
