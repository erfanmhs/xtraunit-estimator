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
import {
  classifyDiscipline,
  isCoreSheet,
  asDiscipline,
  type Discipline,
} from "./discipline";

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
  // Full concatenation — used by the review pass, which sees the whole set.
  planText: string;
  // Per-sheet extracted text tagged with discipline + a "core" flag, so the
  // draft can route only the relevant sheets into each CSI-division chunk while
  // always carrying the shared core (cover/notes/schedules/architectural). See
  // ./routing.ts. Only sheets that actually have text are included.
  sheetDocs: {
    page_number: number;
    name: string | null;
    label: string | null;
    discipline: Discipline;
    is_core: boolean;
    text: string;
  }[];
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
    discipline?: string | null;
  };
  // Prefer the newest columns; degrade one tier at a time so the app keeps
  // working whether or not a given migration has run: discipline (0026) →
  // extracted_text/ingest_method (0009) → the base columns.
  const trySelect = (cols: string) =>
    supabase
      .from("sheets")
      .select(cols)
      .eq("project_id", projectId)
      .order("page_number", { ascending: true });
  let sheetRes = await trySelect(
    "id,plan_file_id,page_number,name,label,notes,extracted_text,ingest_method,discipline",
  );
  if (sheetRes.error)
    sheetRes = await trySelect(
      "id,plan_file_id,page_number,name,label,notes,extracted_text,ingest_method",
    );
  if (sheetRes.error)
    sheetRes = await trySelect("id,plan_file_id,page_number,name,label,notes");
  const sheets = (sheetRes.data ?? null) as unknown as SheetRow[] | null;

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

  // Build the cheap plan text from cached per-sheet extraction, tagging each
  // sheet with its discipline so the draft can route sheets per CSI division.
  const sheetDocs = allSheets
    .filter((s) => (s.extracted_text ?? "").trim().length > 0)
    .map((s) => {
      // Prefer the stored discipline (a user correction, or what Prepare saved);
      // fall back to deriving it so existing / un-prepared projects still route.
      const discipline =
        asDiscipline(s.discipline) ?? classifyDiscipline(s.name, s.label);
      const text = (s.extracted_text ?? "").trim();
      return {
        page_number: s.page_number,
        name: s.name,
        label: s.label,
        discipline,
        is_core: isCoreSheet(discipline, s.name, s.label, text),
        text,
      };
    });

  const planText = sheetDocs
    .map((s) => {
      const title = `${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""}`;
      return `=== ${title} ===\n${s.text}`;
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
    const ids = [...visionPagesByFile.keys()];
    // Resilient to migration 0025 (vision_pdf_path) not being run yet.
    const pfFull = await supabase
      .from("plan_files")
      .select("id,file_name,storage_path,vision_pdf_path")
      .in("id", ids);
    const planFiles = (
      pfFull.error
        ? (
            await supabase
              .from("plan_files")
              .select("id,file_name,storage_path")
              .in("id", ids)
          ).data
        : pfFull.data
    ) as {
      id: string;
      file_name: string;
      storage_path: string;
      vision_pdf_path?: string | null;
    }[] | null;
    for (const pf of planFiles ?? []) {
      if (pf.vision_pdf_path) {
        // Compact, downscaled PDF of only the scanned pages — send it whole.
        plans.push({ file_name: pf.file_name, storage_path: pf.vision_pdf_path, pages: [] });
      } else {
        // No vision PDF yet — fall back to extracting the image pages (capped).
        plans.push({
          file_name: pf.file_name,
          storage_path: pf.storage_path,
          pages: (visionPagesByFile.get(pf.id) ?? []).sort((a, b) => a - b),
        });
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
    sheetDocs,
    plans,
    clarifications,
  };
}
