import { createClient } from "@/lib/supabase/server";
import CostDbBrowser, { type CostEntry } from "./CostDbBrowser";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <h1 className="font-heading text-2xl text-foreground">Cost Database</h1>
        <p className="text-sm text-muted">
          {entries.length} confirmed prices · every price you confirm on a
          project is saved here and reused on future jobs (auto-match + AI
          suggestions).
        </p>
        <CostDbBrowser entries={entries} projectNames={projectNames} />
      </div>
    </div>
  );
}
