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
  // Plan files with image-only sheets that need an AI vision read: a reference
  // plus the exact page numbers needing vision. Only those pages (capped) are
  // sent to the AI — never the whole multi-page file. Streamed at upload time.
  plans: { file_name: string; storage_path: string; pages: number[] }[];
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

  // Which PAGES of each plan file still need an AI vision read (image-only /
  // un-ingested sheets). Text-extracted sheets are skipped — and crucially, we
  // send the AI only these specific pages, never the whole multi-page file
  // (Anthropic rejects PDFs over its size/page limit with "Could not process PDF").
  const visionPagesByFile = new Map<string, number[]>();
  for (const s of allSheets) {
    if (s.ingest_method === "text" || !s.plan_file_id) continue;
    const arr = visionPagesByFile.get(s.plan_file_id) ?? [];
    arr.push(s.page_number);
    visionPagesByFile.set(s.plan_file_id, arr);
  }
  // Just references + page lists — bytes are downloaded at upload time.
  const plans: { file_name: string; storage_path: string; pages: number[] }[] = [];
  if (visionPagesByFile.size) {
    const { data: planFiles } = await supabase
      .from("plan_files")
      .select("id,file_name,storage_path")
      .in("id", [...visionPagesByFile.keys()]);
    for (const pf of planFiles ?? []) {
      plans.push({
        file_name: pf.file_name,
        storage_path: pf.storage_path,
        pages: (visionPagesByFile.get(pf.id) ?? []).sort((a, b) => a - b),
      });
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
