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
import { hasTableContent } from "./tables";

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

  // Findings with a note/answer → clarifications for the prompt, so a correction
  // (e.g. "6-inch slab, not 4") steers the next Generate. Dismissed findings are
  // skipped. Resilient to migration 0010 (answer) / 0029 (status) not being run.
  type ClaRow = { text: string; answer: string | null; status?: string | null };
  let clarifications: { question: string; answer: string }[] = [];
  let claData: ClaRow[] | null = null;
  const claTop = await supabase
    .from("scope_findings")
    .select("text,answer,status")
    .eq("project_id", projectId)
    .not("answer", "is", null);
  if (!claTop.error) {
    claData = (claTop.data ?? []) as unknown as ClaRow[];
  } else {
    const claMid = await supabase
      .from("scope_findings")
      .select("text,answer")
      .eq("project_id", projectId)
      .not("answer", "is", null);
    if (!claMid.error) claData = (claMid.data ?? []) as unknown as ClaRow[];
  }
  if (claData) {
    clarifications = claData
      .filter((r) => (r.answer ?? "").trim() && r.status !== "dismissed")
      .map((r) => ({ question: r.text, answer: (r.answer as string).trim() }));
  }

  const allSheets = sheets ?? [];

  // Build the cheap plan text from cached per-sheet extraction, tagging each
  // sheet with its discipline so the draft can route sheets per CSI division.
  const sheetDocs = allSheets
    .filter((s) => (s.extracted_text ?? "").trim().length > 0)
    .map((s) => {
      const stored = (s.discipline ?? "").trim();
      const preset = asDiscipline(stored);
      // A custom category (user-typed, not a built-in discipline) can't be
      // routed to a specific trade — treat that sheet as core (always sent).
      const isCustom = !preset && stored.length > 0;
      // Prefer the stored preset discipline; else derive it so existing /
      // un-prepared projects still route.
      const discipline = preset ?? classifyDiscipline(s.name, s.label);
      const text = (s.extracted_text ?? "").trim();
      return {
        page_number: s.page_number,
        name: s.name,
        label: s.label,
        discipline,
        // Custom-categorized, table/schedule, and core-discipline sheets all go
        // to every trade — their values must never be routed away.
        is_core:
          isCustom ||
          isCoreSheet(discipline, s.name, s.label, text) ||
          hasTableContent(text),
        text,
      };
    });

  const planText = sheetDocs
    .map((s) => {
      const title = `${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""}`;
      return `=== ${title} ===\n${s.text}`;
    })
    .join("\n\n");

  // Pages with no text layer (scanned/image-only) must be sent as images.
  // Table/schedule sheets ALSO get an image, but those are baked into the plan
  // file's vision PDF at prepare time — so here we simply ship the vision PDF
  // whenever one exists, and fall back to the raw image-only pages if not.
  const imagePagesByFile = new Map<string, number[]>();
  for (const s of allSheets) {
    if (s.ingest_method === "text" || !s.plan_file_id) continue;
    const arr = imagePagesByFile.get(s.plan_file_id) ?? [];
    arr.push(s.page_number);
    imagePagesByFile.set(s.plan_file_id, arr);
  }
  // Just references + page lists — bytes are downloaded at upload time.
  const plans: { file_name: string; storage_path: string; pages: number[] }[] = [];
  // Fetch ALL plan files for the project: a file can have a vision PDF (scanned
  // AND/OR table sheets) even when it has no image-only sheets. Resilient to
  // migration 0025 (vision_pdf_path) not being run yet.
  const pfFull = await supabase
    .from("plan_files")
    .select("id,file_name,storage_path,vision_pdf_path")
    .eq("project_id", projectId);
  const planFiles = (
    pfFull.error
      ? (
          await supabase
            .from("plan_files")
            .select("id,file_name,storage_path")
            .eq("project_id", projectId)
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
      // Compact, downscaled PDF of the scanned + table sheets — send it whole.
      plans.push({ file_name: pf.file_name, storage_path: pf.vision_pdf_path, pages: [] });
    } else {
      // No vision PDF — fall back to the raw image-only pages (capped later).
      const pages = imagePagesByFile.get(pf.id);
      if (pages && pages.length)
        plans.push({
          file_name: pf.file_name,
          storage_path: pf.storage_path,
          pages: [...pages].sort((a, b) => a - b),
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
    sheetDocs,
    plans,
    clarifications,
  };
}
