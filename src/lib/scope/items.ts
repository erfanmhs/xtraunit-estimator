import "server-only";

/**
 * Canonical cost items — the catalog spine.
 *
 * Every confirmed price is an "observation" (a row in cost_database). This
 * module groups observations into canonical ITEMS ("Interior door, install")
 * so the Cost Database can show ONE standard price per item, the AI can use
 * those real numbers as a reference, and future matching gets cleaner over
 * time. Grouping is automatic (same trade + unit + similar wording); the user
 * cleans up edge cases in the catalog tab.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { similarity, normUnit } from "./match";

export type CostItemRow = {
  id: string;
  division_code: string | null;
  section_code: string | null;
  name: string;
  norm_key: string | null;
  unit: string | null;
  aliases: string[] | null;
  std_cost_override: number | null;
  std_cost_computed: number | null;
  std_count: number | null;
  last_observed: string | null;
  active: boolean;
};

type ObsLike = {
  division_code: string | null;
  section_code: string | null;
  description: string;
  unit: string | null;
};

// Words that don't help identify WHAT an item is — dropped from the match key
// so "Install interior door" and "Interior door" land on the same item.
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "with", "w", "per", "each",
  "install", "installation", "installed", "provide", "supply", "new", "existing",
  "at", "in", "on", "by", "furnish", "set", "place",
]);

/** A small, order-independent fingerprint of the meaningful words in a label. */
export function normKey(s: string): string {
  return [
    ...new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((t) => t && !STOP.has(t)),
    ),
  ]
    .sort()
    .join(" ");
}

const MATCH_THRESHOLD = 0.55; // wording similarity needed to fold into an item
const MAX_ALIASES = 12;

/**
 * Find the canonical item this observation belongs to, creating one if none is
 * close enough. Returns the item id (or null only on a hard DB error). New
 * wordings are remembered as aliases so matching improves with every job.
 */
export async function findOrCreateItem(
  sb: SupabaseClient,
  ownerId: string,
  obs: ObsLike,
): Promise<string | null> {
  const desc = obs.description.trim();
  if (!desc) return null;
  const u = normUnit(obs.unit);

  // Candidates: this owner's items in the same division + same unit (small set).
  const { data, error } = await sb
    .from("cost_items")
    .select(
      "id,division_code,section_code,name,norm_key,unit,aliases,std_cost_override,std_cost_computed,std_count,last_observed,active",
    )
    .eq("owner_id", ownerId);
  if (error) return null;
  const candidates = ((data ?? []) as CostItemRow[]).filter(
    (it) =>
      (it.division_code ?? null) === (obs.division_code ?? null) &&
      normUnit(it.unit) === u,
  );

  const key = normKey(desc);
  let best: { it: CostItemRow; score: number } | null = null;
  for (const it of candidates) {
    // Exact normalized-key match is an immediate, confident hit.
    if (it.norm_key && it.norm_key === key) {
      best = { it, score: 1 };
      break;
    }
    const aliasScores = (it.aliases ?? []).map((a) => similarity(desc, a));
    const score = Math.max(similarity(desc, it.name), 0, ...aliasScores);
    const sectionBonus =
      obs.section_code && it.section_code && obs.section_code === it.section_code
        ? 0.1
        : 0;
    const total = score + sectionBonus;
    if (!best || total > best.score) best = { it, score: total };
  }

  if (best && best.score >= MATCH_THRESHOLD) {
    const it = best.it;
    // Remember a genuinely new wording as an alias (helps future matching).
    const known = new Set([
      it.name.toLowerCase(),
      ...(it.aliases ?? []).map((a) => a.toLowerCase()),
    ]);
    const patch: Record<string, unknown> = {};
    if (!known.has(desc.toLowerCase())) {
      patch.aliases = [...(it.aliases ?? []), desc].slice(-MAX_ALIASES);
    }
    // Backfill a missing section so the item gets more precise over time.
    if (!it.section_code && obs.section_code) patch.section_code = obs.section_code;
    if (Object.keys(patch).length) {
      await sb.from("cost_items").update(patch).eq("id", it.id);
    }
    return it.id;
  }

  // No close match — mint a new canonical item from this observation.
  const { data: created, error: insErr } = await sb
    .from("cost_items")
    .insert({
      owner_id: ownerId,
      division_code: obs.division_code,
      section_code: obs.section_code,
      name: desc,
      norm_key: key,
      unit: obs.unit,
      aliases: [],
    })
    .select("id")
    .single();
  if (insErr || !created) return null;
  return created.id as string;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Recompute an item's standard price from its observations. The computed value
 * is the MEDIAN per-unit direct cost across the item's unit-priced observations
 * (lump/total rows have no per-unit meaning, so they're skipped). Also refreshes
 * how many observations back it and when it was last seen.
 */
export async function recomputeItemStd(
  sb: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { data, error } = await sb
    .from("cost_database")
    .select(
      "price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,created_at",
    )
    .eq("item_id", itemId);
  if (error) return;
  const rows = data ?? [];

  const perUnit: number[] = [];
  let lastObserved: string | null = null;
  for (const r of rows as Record<string, unknown>[]) {
    const created = r.created_at as string | null;
    if (created && (!lastObserved || created > lastObserved)) lastObserved = created;
    const mode = (r.price_mode as string) ?? "unit";
    if (mode !== "unit") continue; // only $/unit rows define a unit cost
    const sum =
      ((r.cost_labor as number) ?? 0) +
      ((r.cost_material as number) ?? 0) +
      ((r.cost_sub as number) ?? 0) +
      ((r.cost_equipment as number) ?? 0) +
      ((r.cost_other as number) ?? 0);
    if (sum > 0) perUnit.push(sum);
  }

  await sb
    .from("cost_items")
    .update({
      std_cost_computed: median(perUnit),
      std_count: perUnit.length,
      last_observed: lastObserved,
    })
    .eq("id", itemId);
}

/** The price the catalog and AI should treat as standard for an item. */
export function standardCost(it: {
  std_cost_override: number | null;
  std_cost_computed: number | null;
}): number | null {
  return it.std_cost_override ?? it.std_cost_computed ?? null;
}
