import "server-only";

/**
 * Gather everything the AI needs to draft a scope for a project:
 *   - the project record (type, client, address, notes)
 *   - the kept sheets (labels, per-sheet AI notes, scale)
 *   - the takeoff DRIVERS (measurements grouped by sheet + layer)
 *   - the plan PDFs themselves (base64, sent to Claude as documents)
 *
 * The user measures a few drivers; the AI blooms them into the full scope by
 * reading the plans. This module assembles both halves of that input.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type BundleMeasurement = {
  sheet_id: string;
  type: string;
  value: number | null;
  unit: string | null;
  layer: string | null;
  wall_height: number | null;
  wall_sided: string | null;
  vol_mode: string | null;
  vol_width: number | null;
  vol_depth: number | null;
};

export type ScopeBundle = {
  project: {
    id: string;
    name: string | null;
    client_name: string | null;
    address: string | null;
    project_type: string | null;
    notes: string | null;
  };
  sheets: {
    id: string;
    page_number: number;
    name: string | null;
    label: string | null;
    notes: string | null;
  }[];
  measurements: BundleMeasurement[];
  // Cached plan text (schedules/notes/callouts) extracted from vector PDFs.
  planText: string;
  // Only the PDFs that still need an AI vision read (image-only sheets).
  plans: { file_name: string; base64: string }[];
  // Answers the user gave to the AI's earlier "question" findings. Fed back into
  // the prompt so a regenerate is more accurate and doesn't re-ask them.
  clarifications: { question: string; answer: string }[];
};

export async function gatherBundle(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ScopeBundle> {
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,client_name,address,project_type,notes")
    .eq("id", projectId)
    .single();

  type SheetRow = {
    id: string;
    plan_file_id: string;
    page_number: number;
    name: string | null;
    label: string | null;
    notes: string | null;
    extracted_text?: string | null;
    ingest_method?: string | null;
  };
  // Prefer the ingest columns; fall back if migration 0009 hasn't run (then all
  // sheets are treated as needing the PDF, i.e. the old behavior).
  const withText = await supabase
    .from("sheets")
    .select(
      "id,plan_file_id,page_number,name,label,notes,extracted_text,ingest_method",
    )
    .eq("project_id", projectId)
    .order("page_number", { ascending: true });
  const sheets = (
    withText.error
      ? (
          await supabase
            .from("sheets")
            .select("id,plan_file_id,page_number,name,label,notes")
            .eq("project_id", projectId)
            .order("page_number", { ascending: true })
        ).data
      : withText.data
  ) as SheetRow[] | null;

  const { data: measurements } = await supabase
    .from("measurements")
    .select(
      "sheet_id,type,value,unit,layer,wall_height,wall_sided,vol_mode,vol_width,vol_depth",
    )
    .eq("project_id", projectId);

  // Answered "question" findings → clarifications for the prompt. Resilient to
  // migration 0010 (answer column) not being run yet.
  let clarifications: { question: string; answer: string }[] = [];
  const claRes = await supabase
    .from("scope_findings")
    .select("text,answer")
    .eq("project_id", projectId)
    .not("answer", "is", null);
  if (!claRes.error) {
    clarifications = (claRes.data ?? [])
      .filter((r) => ((r as { answer: string | null }).answer ?? "").trim())
      .map((r) => {
        const row = r as { text: string; answer: string };
        return { question: row.text, answer: row.answer.trim() };
      });
  }

  const allSheets = sheets ?? [];

  // Build the cheap plan text from cached per-sheet extraction.
  const planText = allSheets
    .filter((s) => (s.extracted_text ?? "").trim().length > 0)
    .map((s) => {
      const title = `${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""}`;
      return `=== ${title} ===\n${(s.extracted_text ?? "").trim()}`;
    })
    .join("\n\n");

  // Only download PDFs for plan files that still have an image-only / un-ingested
  // sheet — those need an AI vision read. Fully text-extracted files are skipped.
  const visionFileIds = [
    ...new Set(
      allSheets
        .filter((s) => s.ingest_method !== "text")
        .map((s) => s.plan_file_id)
        .filter(Boolean),
    ),
  ];
  const plans: { file_name: string; base64: string }[] = [];
  if (visionFileIds.length) {
    const { data: planFiles } = await supabase
      .from("plan_files")
      .select("id,file_name,storage_path")
      .in("id", visionFileIds);
    for (const pf of planFiles ?? []) {
      const { data: blob } = await supabase.storage
        .from("plans")
        .download(pf.storage_path);
      if (blob) {
        const buf = Buffer.from(await blob.arrayBuffer());
        plans.push({ file_name: pf.file_name, base64: buf.toString("base64") });
      }
    }
  }

  return {
    project: project ?? {
      id: projectId,
      name: null,
      client_name: null,
      address: null,
      project_type: null,
      notes: null,
    },
    sheets: allSheets.map((s) => ({
      id: s.id,
      page_number: s.page_number,
      name: s.name,
      label: s.label,
      notes: s.notes,
    })),
    measurements: (measurements as BundleMeasurement[]) ?? [],
    planText,
    plans,
    clarifications,
  };
}
