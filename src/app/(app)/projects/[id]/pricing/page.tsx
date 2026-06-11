import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPricingRun } from "./actions";
import PricingTable, { type PricedLine } from "./PricingTable";
import SuggestPanel from "./SuggestPanel";
import SubQuotes, { type SubQuote } from "./SubQuotes";
import NextStep from "@/components/NextStep";

export default async function PricingPage({
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

  // Pricing columns come from migration 0011 — show a friendly banner if it
  // hasn't been run yet instead of crashing.
  const { data: items, error: itemsError } = await supabase
    .from("line_items")
    .select(
      "id,division_code,division_name,description,quantity,unit,status,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence,price_status,sort_order",
    )
    .eq("project_id", id)
    .order("division_code", { ascending: true })
    .order("sort_order", { ascending: true });

  const migrationMissing = !!itemsError;
  const lines = ((items as PricedLine[]) ?? []).filter(
    (li) => li.status !== "excluded",
  );
  const initialRun = migrationMissing ? null : await getPricingRun(id);

  // Sub quotes + how many lines each covers. Resilient pre-migration-0015.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let subQuotes: SubQuote[] = [];
  const sq = await supabase
    .from("sub_quotes")
    .select("id,sub_name,trade,division_codes,quote_date,total,file_name,notes")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  if (!sq.error && sq.data) {
    const counts: Record<string, number> = {};
    const cv = await supabase
      .from("line_items")
      .select("sub_quote_id")
      .eq("project_id", id)
      .not("sub_quote_id", "is", null);
    if (!cv.error) {
      for (const r of cv.data ?? []) {
        const k = (r as { sub_quote_id: string }).sub_quote_id;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    subQuotes = sq.data.map((q) => ({
      ...q,
      covered_count: counts[q.id] ?? 0,
    })) as SubQuote[];
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href={`/projects/${id}`}
              className="text-xs text-muted transition-colors hover:text-brand-soft"
            >
              ← Back to project
            </Link>
            <h1 className="mt-1 font-heading text-2xl text-foreground">
              Pricing
            </h1>
            <p className="text-sm text-muted">
              {project?.name ?? "Project"} · {lines.length} scope lines · direct
              cost in five buckets (labor / material / sub / equipment / other)
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <NextStep href={`/projects/${id}/estimate`} label="Estimate" />
            {!migrationMissing ? (
              <SuggestPanel projectId={id} initialRun={initialRun} />
            ) : null}
          </div>
        </div>

        {migrationMissing ? (
          <div className="mt-10 rounded-xl border border-brand/40 bg-brand/10 p-6">
            <p className="text-sm text-foreground">
              A database change is needed before pricing works: run the pending
              pricing migration(s) — <span className="font-medium">0011</span> and/or{" "}
              <span className="font-medium">0012</span> — in Supabase (SQL Editor →
              New query → paste → Run). They&apos;re listed in
              supabase/PENDING-DB-CHANGES.md. Then reload this page.
            </p>
          </div>
        ) : lines.length === 0 ? (
          <div className="mt-10 rounded-xl glass p-8 text-center">
            <p className="text-sm text-muted">
              No scope lines to price yet. Generate and review the{" "}
              <Link
                href={`/projects/${id}/scope`}
                className="text-brand-soft hover:underline"
              >
                Scope of Work
              </Link>{" "}
              first — pricing attaches costs to those lines.
            </p>
          </div>
        ) : (
          <>
            {user ? (
              <SubQuotes projectId={id} userId={user.id} quotes={subQuotes} />
            ) : null}
            <PricingTable projectId={id} initialItems={lines} />
          </>
        )}
      </div>
    </div>
  );
}
