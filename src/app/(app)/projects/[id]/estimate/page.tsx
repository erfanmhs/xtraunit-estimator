import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EstimateView from "./EstimateView";
import NextStep from "@/components/NextStep";
import type { PricedLine } from "../pricing/PricingTable";
import type { Markups } from "./actions";

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();

  const { data: items, error: itemsError } = await supabase
    .from("line_items")
    .select(
      "id,division_code,division_name,description,quantity,unit,status,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence,price_status,sort_order",
    )
    .eq("project_id", id)
    .order("division_code", { ascending: true })
    .order("sort_order", { ascending: true });

  // estimates row (markups). Resilient: 0013 not run → defaults + banner.
  const { data: est, error: estError } = await supabase
    .from("estimates")
    .select("contingency_pct,insurance_pct,overhead_pct,profit_pct")
    .eq("project_id", id)
    .maybeSingle();

  const migrationMissing = !!itemsError || !!estError;
  const lines = ((items as PricedLine[]) ?? []).filter(
    (li) => li.status !== "excluded",
  );

  // No saved markups for this project yet? Start from the company defaults
  // (Settings). Saving on the Estimate page then makes them project-specific.
  let markups: Markups = {
    contingency_pct: est?.contingency_pct ?? 0,
    insurance_pct: est?.insurance_pct ?? 0,
    overhead_pct: est?.overhead_pct ?? 0,
    profit_pct: est?.profit_pct ?? 0,
  };
  if (!est) {
    const { data: defaults } = await supabase
      .from("company_settings")
      .select("default_contingency_pct,default_insurance_pct,default_op_pct")
      .maybeSingle();
    if (defaults) {
      markups = {
        contingency_pct: defaults.default_contingency_pct ?? 0,
        insurance_pct: defaults.default_insurance_pct ?? 0,
        overhead_pct: defaults.default_op_pct ?? 0,
        profit_pct: 0,
      };
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href={`/projects/${id}`}
              className="text-xs text-muted transition-colors hover:text-brand-soft"
            >
              ← Back to project
            </Link>
            <h1 className="mt-1 font-heading text-2xl text-foreground">
              Estimate
            </h1>
            <p className="text-sm text-muted">
              {project?.name ?? "Project"} · direct cost + markups = the bid number
            </p>
          </div>
          <NextStep href={`/projects/${id}/proposal`} label="Proposal" />
        </div>

        {migrationMissing ? (
          <div className="mt-10 rounded-xl border border-brand/40 bg-brand/10 p-6">
            <p className="text-sm text-foreground">
              A database change is needed before the estimate works: run the
              pending migration(s) — up through{" "}
              <span className="font-medium">0013_phase10_estimate.sql</span> — in
              Supabase (SQL Editor → New query → paste → Run). They&apos;re listed
              in supabase/PENDING-DB-CHANGES.md. Then reload this page.
            </p>
          </div>
        ) : lines.length === 0 ? (
          <div className="mt-10 rounded-xl glass p-8 text-center">
            <p className="text-sm text-muted">
              Nothing to estimate yet. Build the{" "}
              <Link
                href={`/projects/${id}/scope`}
                className="text-brand-soft hover:underline"
              >
                Scope of Work
              </Link>{" "}
              and{" "}
              <Link
                href={`/projects/${id}/pricing`}
                className="text-brand-soft hover:underline"
              >
                price the lines
              </Link>{" "}
              first.
            </p>
          </div>
        ) : (
          <EstimateView
            projectId={id}
            projectName={project?.name ?? "Project"}
            lines={lines}
            initialMarkups={markups}
          />
        )}
      </div>
    </div>
  );
}
