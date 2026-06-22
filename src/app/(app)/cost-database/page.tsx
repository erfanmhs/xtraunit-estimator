import { createClient } from "@/lib/supabase/server";
import { type CostEntry } from "./CostDbBrowser";
import CostDatabaseTabs from "./CostDatabaseTabs";
import type {
  Benchmark,
  UnitPrice,
  CostItem,
  ObservedBenchmark,
} from "./actions";

// Starting references shown when nothing is saved yet. Benchmarks: labels only
// (the $/SF numbers are the user's to enter). Unit prices: DIRECT cost catalog
// from XtraUnit's contracts (allowances as-is; installed add-ons de-margined) —
// used to seed the cost-items catalog on first build.
const DEFAULT_BENCHMARKS: Benchmark[] = [
  { label: "ADU", sell_low: null, sell_high: null },
  { label: "Multifamily", sell_low: null, sell_high: null },
  { label: "Custom residential & additions", sell_low: null, sell_high: null },
];
const DEFAULT_UNIT_PRICES: UnitPrice[] = [
  { item: "Window (48x48)", unit: "ea", cost: 350 },
  { item: "Entrance door", unit: "ea", cost: 120 },
  { item: "Interior door", unit: "ea", cost: 85 },
  { item: "Closet door 24x80", unit: "ea", cost: 100 },
  { item: "Kitchen sink", unit: "ea", cost: 150 },
  { item: "Kitchen faucet", unit: "ea", cost: 100 },
  { item: "Vanity sink", unit: "ea", cost: 50 },
  { item: "Vanity faucet", unit: "ea", cost: 65 },
  { item: "Shower enclosure", unit: "ea", cost: 350 },
  { item: "Outdoor light w/ motion", unit: "ea", cost: 45 },
  { item: "Bathroom wall & floor tile", unit: "sf", cost: 1.5 },
  { item: "Shower pan tile", unit: "sf", cost: 4.5 },
  { item: "Laminate flooring", unit: "sf", cost: 1.4 },
  { item: "Baseboard", unit: "lf", cost: 0.56 },
  { item: "Mini-split 12k BTU (matl + accessories)", unit: "ea", cost: 1458 },
  { item: "Garage floor leveling", unit: "ea", cost: 2500 },
  { item: "Electrical panel upgrade", unit: "ea", cost: 5667 },
  { item: "Upgrade to 200A + twin meter", unit: "ea", cost: 6500 },
];

type LineForSf = {
  project_id: string | null;
  price_mode: string | null;
  quantity: number | null;
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
};

function lineDirect(li: LineForSf): number {
  const mode = li.price_mode ?? "unit";
  if (mode === "total") return li.cost_total ?? 0;
  const sum =
    (li.cost_labor ?? 0) +
    (li.cost_material ?? 0) +
    (li.cost_sub ?? 0) +
    (li.cost_equipment ?? 0) +
    (li.cost_other ?? 0);
  return mode === "lump" ? sum : (li.quantity ?? 0) * sum;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default async function CostDatabasePage() {
  const supabase = await createClient();

  // Resilient to migration 0014 (section_code) not being run yet.
  let rows: unknown[] | null = null;
  const r1 = await supabase
    .from("cost_database")
    .select(
      "id,created_at,project_id,division_code,section_code,description,unit,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!r1.error) rows = r1.data;
  else {
    const r2 = await supabase
      .from("cost_database")
      .select(
        "id,created_at,project_id,division_code,description,unit,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence",
      )
      .order("created_at", { ascending: false })
      .limit(1000);
    rows = r2.data;
  }
  const entries = ((rows ?? []) as Partial<CostEntry>[]).map((e) => ({
    section_code: null,
    ...e,
  })) as CostEntry[];

  // Resolve project names for provenance display.
  const projectIds = [
    ...new Set(entries.map((e) => e.project_id).filter(Boolean)),
  ] as string[];
  const projectNames: Record<string, string> = {};
  if (projectIds.length) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id,name")
      .in("id", projectIds);
    for (const p of projects ?? []) projectNames[p.id] = p.name ?? "Untitled";
  }

  // Pricing references (live on company_settings). Resilient via select("*").
  const cs = await supabase.from("company_settings").select("*").maybeSingle();
  const benchmarks: Benchmark[] =
    Array.isArray(cs.data?.benchmarks) && cs.data.benchmarks.length
      ? (cs.data.benchmarks as Benchmark[])
      : DEFAULT_BENCHMARKS;
  const unitPrices: UnitPrice[] =
    Array.isArray(cs.data?.unit_prices) && cs.data.unit_prices.length
      ? (cs.data.unit_prices as UnitPrice[])
      : DEFAULT_UNIT_PRICES;

  // Cost items catalog. Resilient if migration 0021 hasn't run yet.
  let items: CostItem[] = [];
  const itemsRes = await supabase
    .from("cost_items")
    .select(
      "id,division_code,section_code,name,unit,std_cost_override,std_cost_computed,std_count,last_observed",
    )
    .order("division_code", { ascending: true });
  if (!itemsRes.error) items = (itemsRes.data ?? []) as CostItem[];

  // Observed direct $/SF by project type (computed from confirmed work).
  const observed = await computeObservedBenchmarks(supabase);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <h1 className="font-heading text-2xl text-foreground">Cost Database</h1>
        <p className="text-sm text-muted">
          XtraUnit&apos;s cost knowledge — your confirmed price history, your cost
          items catalog, and $/SF benchmarks. All of it feeds the pricing AI.
        </p>
        <CostDatabaseTabs
          entries={entries}
          projectNames={projectNames}
          items={items}
          unitPrices={unitPrices}
          benchmarks={benchmarks}
          observed={observed}
        />
      </div>
    </div>
  );
}

async function computeObservedBenchmarks(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ObservedBenchmark[]> {
  // Projects with a known type, their building size, and confirmed direct cost.
  const { data: projects, error: pErr } = await supabase
    .from("projects")
    .select("id,project_type");
  if (pErr || !projects?.length) return [];

  let estimates: { project_id: string; building_sf: number | null }[] = [];
  const estRes = await supabase
    .from("estimates")
    .select("project_id,building_sf");
  if (!estRes.error) estimates = (estRes.data ?? []) as typeof estimates;
  const sfByProject = new Map<string, number>();
  for (const e of estimates)
    if (e.building_sf && e.building_sf > 0) sfByProject.set(e.project_id, e.building_sf);
  if (!sfByProject.size) return [];

  const { data: lines, error: lErr } = await supabase
    .from("line_items")
    .select(
      "project_id,price_mode,quantity,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total",
    )
    .eq("price_status", "confirmed")
    .limit(5000);
  if (lErr || !lines?.length) return [];

  const directByProject = new Map<string, number>();
  for (const li of lines as LineForSf[]) {
    if (!li.project_id || !sfByProject.has(li.project_id)) continue;
    directByProject.set(
      li.project_id,
      (directByProject.get(li.project_id) ?? 0) + lineDirect(li),
    );
  }

  const typeByProject = new Map<string, string>();
  for (const p of projects)
    typeByProject.set(p.id, (p.project_type as string | null)?.trim() || "Other");

  // $/SF per project, grouped by type.
  const byType = new Map<string, number[]>();
  for (const [pid, direct] of directByProject) {
    const sf = sfByProject.get(pid)!;
    if (!sf || direct <= 0) continue;
    const psf = direct / sf;
    const type = typeByProject.get(pid) ?? "Other";
    (byType.get(type) ?? byType.set(type, []).get(type)!).push(psf);
  }

  const out: ObservedBenchmark[] = [];
  for (const [label, vals] of byType) {
    if (!vals.length) continue;
    out.push({
      label,
      low: Math.min(...vals),
      high: Math.max(...vals),
      median: median(vals),
      n: vals.length,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
