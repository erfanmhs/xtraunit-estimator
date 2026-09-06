import "server-only";

/**
 * Per-project overview for the Projects list: where each job stands (the six
 * stages) and its money so far. Five bulk reads for ALL the user's projects at
 * once (RLS-scoped), aggregated here — no per-card round trips. Any table that
 * isn't there yet just reads as "nothing", never an error on the list page.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Stage = "done" | "partial" | "todo";

export type ProjectOverview = {
  stages: {
    plans: Stage;
    takeoff: Stage;
    scope: Stage;
    pricing: Stage;
    estimate: Stage;
    proposal: Stage;
  };
  /** Direct cost of every priced line (confirmed + proposed). */
  directCost: number;
  /** Direct cost of confirmed lines only. */
  confirmedCost: number;
  /** The bid number = direct cost through the markup waterfall, once an
   *  estimate exists (null before). */
  bid: number | null;
  lines: number;
};

type LineRow = {
  project_id: string;
  status: string | null;
  price_status: string | null;
  price_mode: string | null;
  quantity: number | null;
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
};

// Same math as the Pricing/Estimate pages (PricingTable.lineTotal).
function lineTotal(li: LineRow): number {
  const mode = li.price_mode ?? "unit";
  if (mode === "total") return li.cost_total ?? 0;
  const sum =
    (li.cost_labor ?? 0) +
    (li.cost_material ?? 0) +
    (li.cost_sub ?? 0) +
    (li.cost_equipment ?? 0) +
    (li.cost_other ?? 0);
  if (mode === "lump") return sum;
  return (li.quantity ?? 0) * sum;
}

type EstimateRow = {
  project_id: string;
  contingency_pct: number | null;
  insurance_pct: number | null;
  overhead_pct: number | null;
};

// The Estimate page's waterfall: contingency → insurance → overhead & profit.
function bidFromDirect(direct: number, e: EstimateRow): number {
  let running = direct;
  for (const pct of [e.contingency_pct, e.insurance_pct, e.overhead_pct])
    running += running * ((pct ?? 0) / 100);
  return running;
}

export async function getProjectsOverview(
  sb: SupabaseClient,
  projectIds: string[],
): Promise<Record<string, ProjectOverview>> {
  const out: Record<string, ProjectOverview> = {};
  if (!projectIds.length) return out;
  for (const id of projectIds)
    out[id] = {
      stages: {
        plans: "todo",
        takeoff: "todo",
        scope: "todo",
        pricing: "todo",
        estimate: "todo",
        proposal: "todo",
      },
      directCost: 0,
      confirmedCost: 0,
      bid: null,
      lines: 0,
    };

  const ids = projectIds;
  const [plans, measurements, lines, estimates, proposals] = await Promise.all([
    sb.from("plan_files").select("project_id").in("project_id", ids),
    sb.from("measurements").select("project_id").in("project_id", ids),
    sb
      .from("line_items")
      .select(
        "project_id,status,price_status,price_mode,quantity,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total",
      )
      .in("project_id", ids),
    sb
      .from("estimates")
      .select("project_id,contingency_pct,insurance_pct,overhead_pct")
      .in("project_id", ids),
    sb.from("proposals").select("project_id").in("project_id", ids),
  ]);

  const mark = (rows: { project_id: string }[] | null, key: "plans" | "takeoff" | "proposal") => {
    for (const r of rows ?? []) if (out[r.project_id]) out[r.project_id].stages[key] = "done";
  };
  if (!plans.error) mark(plans.data, "plans");
  if (!measurements.error) mark(measurements.data, "takeoff");
  if (!proposals.error) mark(proposals.data, "proposal");

  const proposedCount: Record<string, number> = {};
  const confirmedCount: Record<string, number> = {};
  if (!lines.error) {
    for (const r of (lines.data ?? []) as LineRow[]) {
      const o = out[r.project_id];
      if (!o || r.status === "excluded") continue;
      o.lines += 1;
      o.stages.scope = "done";
      if (r.price_status === "confirmed" || r.price_status === "proposed") {
        const t = lineTotal(r);
        o.directCost += t;
        if (r.price_status === "confirmed") {
          o.confirmedCost += t;
          confirmedCount[r.project_id] = (confirmedCount[r.project_id] ?? 0) + 1;
        } else proposedCount[r.project_id] = (proposedCount[r.project_id] ?? 0) + 1;
      }
    }
    for (const id of ids) {
      const o = out[id];
      o.stages.pricing =
        (confirmedCount[id] ?? 0) > 0 ? "done" : (proposedCount[id] ?? 0) > 0 ? "partial" : "todo";
    }
  }

  if (!estimates.error) {
    for (const e of (estimates.data ?? []) as EstimateRow[]) {
      const o = out[e.project_id];
      if (!o) continue;
      o.stages.estimate = "done";
      o.bid = bidFromDirect(o.directCost, e);
    }
  }

  return out;
}
