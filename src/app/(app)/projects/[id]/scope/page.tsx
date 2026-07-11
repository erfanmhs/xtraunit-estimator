import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopeRun } from "./actions";
import GeneratePanel from "./GeneratePanel";
import PreparePlans from "./PreparePlans";
import ScopeCanvas, { type LineItem } from "./ScopeCanvas";
import FindingsReview, { type Finding } from "./FindingsReview";
import SheetDisciplines from "./SheetDisciplines";
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

  // Resilient to migration 0030 (gen_trades) not being run yet.
  const projRes = await supabase
    .from("projects")
    .select("id,name,gen_trades")
    .eq("id", id)
    .maybeSingle();
  const project = (
    projRes.error
      ? (
          await supabase
            .from("projects")
            .select("id,name")
            .eq("id", id)
            .maybeSingle()
        ).data
      : projRes.data
  ) as { id: string; name: string | null; gen_trades?: string[] | null } | null;
  const genTrades = Array.isArray(project?.gen_trades) ? project.gen_trades : [];

  const { data: items } = await supabase
    .from("line_items")
    .select(
      "id,division_code,division_name,section_code,section_name,description,quantity,unit,source_kind,confidence,status,evidence,sort_order",
    )
    .eq("project_id", id)
    .order("division_code", { ascending: true })
    .order("sort_order", { ascending: true });

  // Findings — resilient to migrations 0010 (answer) / 0029 (status) not run.
  let findingRows: Finding[] = [];
  const fTop = await supabase
    .from("scope_findings")
    .select("id,kind,text,severity,answer,resolved,status")
    .eq("project_id", id);
  if (!fTop.error) {
    findingRows = (fTop.data as Finding[]) ?? [];
  } else {
    const fMid = await supabase
      .from("scope_findings")
      .select("id,kind,text,severity,answer,resolved")
      .eq("project_id", id);
    if (!fMid.error) {
      findingRows = (fMid.data ?? []).map((f) => ({
        ...(f as Omit<Finding, "status">),
        status: null,
      }));
    } else {
      const fb = await supabase
        .from("scope_findings")
        .select("id,kind,text,severity")
        .eq("project_id", id);
      findingRows = (fb.data ?? []).map(
        (f: {
          id: string;
          kind: string;
          text: string;
          severity: string | null;
        }) => ({ ...f, answer: null, resolved: false, status: null }),
      );
    }
  }

  const { count: measurementCount } = await supabase
    .from("measurements")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);

  const initialRun = await getScopeRun(id);

  // Plan files + sheet ingest state (for the "Prepare plans" step). Resilient to
  // migration 0025 (vision_pdf_path) not being run yet.
  const pfFull = await supabase
    .from("plan_files")
    .select("id,file_name,storage_path,vision_pdf_path")
    .eq("project_id", id);
  const planFilesRaw = pfFull.error
    ? (
        await supabase
          .from("plan_files")
          .select("id,file_name,storage_path")
          .eq("project_id", id)
      ).data
    : pfFull.data;
  const planFiles = (planFilesRaw ?? []).map(
    (p: {
      id: string;
      file_name: string;
      storage_path: string;
      vision_pdf_path?: string | null;
    }) => ({
      id: p.id,
      file_name: p.file_name,
      storage_path: p.storage_path,
      hasVisionPdf: !!p.vision_pdf_path,
    }),
  );
  // Resilient to migrations 0026 (discipline) / 0028 (ingest_version) not run.
  const sheetSel =
    "id,page_number,plan_file_id,ingest_method,name,label,discipline,ingest_version";
  const shRes = await supabase.from("sheets").select(sheetSel).eq("project_id", id);
  const sheetRows = (
    shRes.error
      ? (
          await supabase
            .from("sheets")
            .select("id,page_number,plan_file_id,ingest_method,name,label")
            .eq("project_id", id)
        ).data
      : shRes.data
  ) as
    | {
        id: string;
        page_number: number;
        plan_file_id: string;
        ingest_method: string | null;
        name: string | null;
        label: string | null;
        discipline?: string | null;
        ingest_version?: number | null;
      }[]
    | null;
  const ingestSheets = (sheetRows ?? [])
    .map((s) => ({
      id: s.id,
      page_number: s.page_number,
      plan_file_id: s.plan_file_id,
      ingestMethod: s.ingest_method,
      ingestVersion: s.ingest_version ?? null,
      name: s.name,
      label: s.label,
      discipline: s.discipline ?? null,
    }))
    .sort((a, b) => a.page_number - b.page_number);

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
              initialTrades={genTrades}
            />
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
            {error}
          </p>
        ) : null}

        <PreparePlans plans={planFiles ?? []} sheets={ingestSheets} />

        {ingestSheets.length ? (
          <SheetDisciplines
            sheets={ingestSheets.map((s) => ({
              id: s.id,
              page_number: s.page_number,
              name: s.name,
              label: s.label,
              discipline: s.discipline,
            }))}
          />
        ) : null}

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

        <FindingsReview projectId={id} initialFindings={findingRows} />
      </div>
    </div>
  );
}
