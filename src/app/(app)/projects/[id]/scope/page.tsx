import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopeRun } from "./actions";
import GeneratePanel from "./GeneratePanel";
import PreparePlans from "./PreparePlans";
import ScopeCanvas, { type LineItem } from "./ScopeCanvas";
import FindingsReview, { type Finding } from "./FindingsReview";
import NextStep from "@/components/NextStep";

export default async function ScopePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();

  const { data: items } = await supabase
    .from("line_items")
    .select(
      "id,division_code,division_name,section_code,section_name,description,quantity,unit,source_kind,confidence,status,evidence,sort_order",
    )
    .eq("project_id", id)
    .order("division_code", { ascending: true })
    .order("sort_order", { ascending: true });

  // Findings — resilient to migration 0010 (answer column) not being run yet.
  let findingRows: Finding[] = [];
  const fres = await supabase
    .from("scope_findings")
    .select("id,kind,text,severity,answer,resolved")
    .eq("project_id", id);
  if (fres.error) {
    const fb = await supabase
      .from("scope_findings")
      .select("id,kind,text,severity")
      .eq("project_id", id);
    findingRows = (fb.data ?? []).map(
      (f: { id: string; kind: string; text: string; severity: string | null }) => ({
        ...f,
        answer: null,
        resolved: false,
      }),
    );
  } else {
    findingRows = (fres.data as Finding[]) ?? [];
  }

  const { count: measurementCount } = await supabase
    .from("measurements")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);

  const initialRun = await getScopeRun(id);

  // Plan files + sheet ingest state (for the "Prepare plans" step). Resilient to
  // the extracted_text column not existing yet (migration 0009 not run).
  const { data: planFiles } = await supabase
    .from("plan_files")
    .select("id,file_name,storage_path")
    .eq("project_id", id);
  const { data: sheetRows } = await supabase
    .from("sheets")
    .select("id,page_number,plan_file_id,extracted_text")
    .eq("project_id", id);
  const ingestSheets = (sheetRows ?? []).map(
    (s: {
      id: string;
      page_number: number;
      plan_file_id: string;
      extracted_text: string | null;
    }) => ({
      id: s.id,
      page_number: s.page_number,
      plan_file_id: s.plan_file_id,
      hasText: !!(s.extracted_text ?? "").trim(),
    }),
  );

  const lineItems = (items as LineItem[]) ?? [];

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
              Scope of Work
            </h1>
            <p className="text-sm text-muted">
              {project?.name ?? "Project"} · {lineItems.length} line items ·{" "}
              {measurementCount ?? 0} measurements used
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <NextStep href={`/projects/${id}/pricing`} label="Pricing" />
            <GeneratePanel
              projectId={id}
              initialRun={initialRun}
              hasScope={lineItems.length > 0}
            />
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
            {error}
          </p>
        ) : null}

        <PreparePlans plans={planFiles ?? []} sheets={ingestSheets} />

        {lineItems.length === 0 ? (
          <div className="mt-10 rounded-xl glass p-8 text-center">
            <p className="text-sm text-muted">
              No scope yet. The AI reads your plans and takeoff drivers and drafts
              the scope by CSI division. Measure your key quantities first, then
              click <span className="text-foreground">Generate scope with AI</span>.
            </p>
          </div>
        ) : (
          <ScopeCanvas projectId={id} initialItems={lineItems} />
        )}

        <FindingsReview initialFindings={findingRows} />
      </div>
    </div>
  );
}
