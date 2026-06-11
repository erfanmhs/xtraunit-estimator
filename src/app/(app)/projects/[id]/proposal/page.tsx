import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ProposalView, {
  type CompanyInfo,
  type ProposalRow,
  type FindingLite,
} from "./ProposalView";
import type { PricedLine } from "../pricing/PricingTable";
import type { Markups } from "../estimate/actions";

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id,name,client_name,address")
    .eq("id", id)
    .maybeSingle();

  const { data: items } = await supabase
    .from("line_items")
    .select(
      "id,division_code,division_name,description,quantity,unit,status,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence,price_status,sort_order",
    )
    .eq("project_id", id)
    .order("division_code", { ascending: true })
    .order("sort_order", { ascending: true });
  const lines = ((items as PricedLine[]) ?? []).filter(
    (li) => li.status !== "excluded",
  );

  // Markups: project's own, else company defaults.
  const { data: est } = await supabase
    .from("estimates")
    .select("contingency_pct,insurance_pct,overhead_pct,profit_pct")
    .eq("project_id", id)
    .maybeSingle();
  let markups: Markups = {
    contingency_pct: est?.contingency_pct ?? 0,
    insurance_pct: est?.insurance_pct ?? 0,
    overhead_pct: (est?.overhead_pct ?? 0) + (est?.profit_pct ?? 0),
    profit_pct: 0,
  };
  const { data: cs } = await supabase
    .from("company_settings")
    .select(
      "company_name,company_address,company_phone,company_email,company_license,default_contingency_pct,default_insurance_pct,default_op_pct",
    )
    .maybeSingle();
  if (!est && cs) {
    markups = {
      contingency_pct: cs.default_contingency_pct ?? 0,
      insurance_pct: cs.default_insurance_pct ?? 0,
      overhead_pct: cs.default_op_pct ?? 0,
      profit_pct: 0,
    };
  }
  const company: CompanyInfo = {
    company_name: cs?.company_name ?? null,
    company_address: cs?.company_address ?? null,
    company_phone: cs?.company_phone ?? null,
    company_email: cs?.company_email ?? null,
    company_license: cs?.company_license ?? null,
  };

  // Assumptions & exclusions from the AI review (unresolved ones).
  const { data: findings } = await supabase
    .from("scope_findings")
    .select("kind,text,resolved")
    .eq("project_id", id)
    .in("kind", ["assumption", "exclusion"]);
  const findingsLite: FindingLite[] = (findings ?? [])
    .filter((f) => !f.resolved)
    .map((f) => ({ kind: f.kind, text: f.text }));

  // Saved proposal (letter etc.). Banner if migration 0017 is missing.
  const prop = await supabase
    .from("proposals")
    .select("letter_text,client_name,proposal_date")
    .eq("project_id", id)
    .maybeSingle();
  const migrationMissing = !!prop.error;
  const initial: ProposalRow = {
    letter_text: prop.data?.letter_text ?? null,
    client_name: prop.data?.client_name ?? null,
    proposal_date: prop.data?.proposal_date ?? null,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        <div className="print-hide">
          <Link
            href={`/projects/${id}`}
            className="text-xs text-muted transition-colors hover:text-brand-soft"
          >
            ← Back to project
          </Link>
          <h1 className="mt-1 font-heading text-2xl text-foreground">
            Proposal
          </h1>
          <p className="text-sm text-muted">
            {project?.name ?? "Project"} · the client-ready document — letter,
            cost summary, assumptions &amp; exclusions
          </p>
        </div>

        {migrationMissing ? (
          <div className="mt-10 rounded-xl border border-brand/40 bg-brand/10 p-6">
            <p className="text-sm text-foreground">
              One database change is needed first: run{" "}
              <span className="font-medium">0017_phase11_proposals.sql</span> in
              Supabase (SQL Editor → New query → paste → Run), then reload.
            </p>
          </div>
        ) : lines.length === 0 ? (
          <div className="mt-10 rounded-xl glass p-8 text-center">
            <p className="text-sm text-muted">
              Nothing to propose yet — build the scope and pricing first.
            </p>
          </div>
        ) : (
          <ProposalView
            projectId={id}
            company={company}
            project={{
              name: project?.name ?? "Project",
              client_name: project?.client_name ?? null,
              address: project?.address ?? null,
            }}
            lines={lines}
            markups={markups}
            findings={findingsLite}
            initial={initial}
          />
        )}
      </div>
    </div>
  );
}
