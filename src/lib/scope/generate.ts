import "server-only";

/**
 * AI scope of work — generation.
 *
 * Pass 1 (Fable 5): read the plans + the user's takeoff drivers and BLOOM them
 *   into a full scope of work organized by CSI division. Every line is grounded
 *   (evidence + formula + assumptions); AI quantities stay "proposed".
 * Pass 2 (Opus 4.8): a second-opinion / gap-finder over the draft + plans —
 *   what's missing, what's unclear, shaky assumptions, exclusions, open
 *   questions. A different model on purpose: an independent second opinion.
 *
 * Rules baked into the prompts:
 *   - The AI may measure/estimate, but every number is a proposal to be checked.
 *   - No Builder's-vs-Owner's-cost split — owner-furnished items become exclusions.
 *   - Never invent a price (pricing is a later phase).
 */
import { toFile } from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "@/lib/anthropic";
import type { ScopeBundle, BundleMeasurement } from "./bundle";
import { taxonomyPromptText } from "./taxonomy";
import { routedDisciplines } from "./routing";

// Anthropic's document-PDF limits. We stay safely under both, and only ever
// send the specific image-only pages (not the whole plan file).
const MAX_PDF_BYTES = 28 * 1024 * 1024; // < the ~32 MB request limit (leave headroom)
const MAX_PDF_PAGES = 95; // < the 100-page limit

// Models come from one config (env-overridable) — see src/config/ai.ts.
import { AI_MODELS } from "@/config/ai";

const DRAFT_MODEL = AI_MODELS.scopeDraft;
const CRITIQUE_MODEL = AI_MODELS.scopeReview;
const FILES_BETA = "files-api-2025-04-14";

export type GeneratedLineItem = {
  division_code: string;
  division_name: string;
  section_code: string | null;
  section_name: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  source_kind: string;
  evidence_text: string | null;
  based_on_layers: string[];
  formula: string | null;
  assumptions: string[];
  confidence: string;
};
export type GeneratedFinding = {
  kind: string; // gap | assumption | exclusion | question
  text: string;
  severity: string; // high | medium | low
  options: string[]; // quick answer choices for a "question" (best guess first); [] otherwise
};

const COMPANY_CONTEXT = `XtraUnit is a licensed California general contractor (CA #1033830) that prices ALL trades on a job — site work, concrete, framing, MEP, finishes, etc. You are preparing a scope of work for the XtraUnit estimating team.`;

const RULES = `Critical rules:
- COMPREHENSIVE COVERAGE IS REQUIRED. Scope the ENTIRE project the way a general contractor bidding ALL trades would: every trade and CSI division the plans show, PLUS everything a building of this type normally requires (sitework, demo, concrete/foundations, framing, roofing, doors/windows, insulation, drywall, finishes, plumbing, HVAC, electrical, fire protection, specialties, etc.). Aim for thorough, not minimal.
- READ THE DIMENSIONS. The plan content includes dimension strings, grid spacings, ceiling heights, and other numbers printed on the drawings — use them, together with the user's takeoff measurements, as the AUTHORITATIVE basis for every quantity you propose. When a printed dimension and your visual estimate disagree, the printed dimension wins; when the user's measurement and anything else disagree, the user's measurement wins.
- The user's measurements are ANCHORS, NOT LIMITS. Do NOT restrict the scope to only the areas the user measured. Measured areas should be richer/higher-confidence, but you must ALSO scope everything else in the plans even when the user gave no measurement for it.
- For work with no user measurement, you MUST still include the scope line and PROPOSE the quantity yourself — read the plans, COUNT items in the schedules, and estimate from dimensions/areas. Never omit a needed scope line just because the user didn't measure it. If you truly can't put a number, include the line with quantity null and a note, but always include the line.
- COUNT THE SCHEDULES. Read every schedule (door, window, finish, fixture/equipment) and fold the counts INTO the matching subcategory line — total the quantity and put the per-type breakdown in "formula" (e.g. "door schedule: 3070×4 + 3068×6 = 10 interior doors"). Do this even though the user did not measure doors/windows.
- Every quantity you provide is a PROPOSAL the user will check. Show your work: set "formula" (e.g. "door schedule: 4+6+2 = 12 doors", or "2400 sf slab × 4in ÷ 27 = 35.6 cy") and list "assumptions". Set source_kind to "takeoff" (user measured), "derived" (computed from a measurement), "ai_measured" (you counted/measured it off the drawing or schedule), "schedule", "note", "drawing", or "assumption".
- Do NOT split Builder's vs Owner's cost. Owner-furnished or out-of-contract items go in findings as an "exclusion".
- Never invent prices — no costs at all in this phase.
- ASSUME FIRST, ASK RARELY, KEEP IT SHORT. Make a reasonable, clearly-stated assumption for normal unknowns (slab thickness, wall height, common finishes) and record it in the line's "assumptions" — do NOT turn every unknown into a question. Only add a kind "question" finding when an answer would SIGNIFICANTLY change cost AND you cannot infer it. HARD CAP: at most 3 questions for the whole project. Every finding's "text" must be ONE short line (≤ ~15 words), never a paragraph. For each "question", also fill "options": 2–4 very short answer choices with your recommended/most-likely answer FIRST (e.g. ["4-inch","5-inch","6-inch"] or ["In contract","By owner"]). For every non-question finding, set "options" to []. A short, confident scope with stated assumptions beats one buried in questions.
- Use CSI MasterFormat divisions (e.g. 03 Concrete, 06 Wood/Plastics/Composites, 08 Openings, 09 Finishes, 22 Plumbing, 23 HVAC, 26 Electrical). division_code is the 2-digit number, division_name the title.
- ALWAYS assign the CSI SECTION under the division: section_code is the standard 6-digit MasterFormat section written "06 10 00", section_name its title ("Rough Carpentry"). Group related work under the same section — e.g. 03 30 00 Cast-in-Place Concrete, 06 10 00 Rough Carpentry, 07 21 00 Thermal Insulation, 08 11 00 Metal Doors and Frames, 09 29 00 Gypsum Board, 22 40 00 Plumbing Fixtures. Never leave section_code/section_name null.
- ORGANIZE THE SCOPE BY STANDARD SUBCATEGORIES. For each division use the STANDARD SUBCATEGORIES listed later in this prompt. Produce ONE line item per subcategory the project actually has, and ROLL granular components up into that package — e.g. studs, joists, sheathing, hold-downs and connectors all become a single "Wood Framing — walls, floors & roof" line; put the component breakdown in "formula"/"assumptions", NEVER as separate lines. Keep it short, standardized and client-clear — typically 3–8 lines per division.
- DESCRIPTION = the subcategory's EXACT standard label, optionally followed by " — <spec/type/extent>" ONLY when the plans show a specific product, type, or location worth noting (e.g. "Windows — vinyl, per schedule", "Wood Framing — walls, floors & roof (Type V-A)"). Do NOT use action-verb sentences, narrative, or explanations in description — that material belongs in evidence_text/assumptions.
- Use the subcategory's SECTION CODE for section_code (and its title for section_name).
- ADD A SUBCATEGORY ONLY WHEN NEEDED: if the project has real scope that fits NONE of the listed subcategories for its division, you MAY add ONE new line at the same work-package level, in the same formal CSI-style wording (a section title + short scope). Never create a near-duplicate of a listed subcategory.
- Within each section, order line items in construction sequence: below-grade → structure → exterior shell → interior, lower floors before upper floors.
- Use the SAME standard subcategory label for the same work on every project — identical phrasing is required so past prices match future jobs.
- confidence is "high", "medium", or "low" (high when measured or counted from a schedule; lower when broadly estimated).`;

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          division_code: { type: "string" },
          division_name: { type: "string" },
          section_code: { type: ["string", "null"] },
          section_name: { type: ["string", "null"] },
          description: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          source_kind: { type: "string" },
          evidence_text: { type: ["string", "null"] },
          based_on_layers: { type: "array", items: { type: "string" } },
          formula: { type: ["string", "null"] },
          assumptions: { type: "array", items: { type: "string" } },
          confidence: { type: "string" },
        },
        required: [
          "division_code",
          "division_name",
          "section_code",
          "section_name",
          "description",
          "quantity",
          "unit",
          "source_kind",
          "evidence_text",
          "based_on_layers",
          "formula",
          "assumptions",
          "confidence",
        ],
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          text: { type: "string" },
          severity: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "text", "severity", "options"],
      },
    },
  },
  required: ["line_items", "findings"],
} as const;

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          text: { type: "string" },
          severity: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "text", "severity", "options"],
      },
    },
  },
  required: ["findings"],
} as const;

function takeoffText(bundle: ScopeBundle): string {
  const sheetName = (id: string) => {
    const s = bundle.sheets.find((x) => x.id === id);
    return s ? s.name || `Sheet ${s.page_number}` : "Unknown sheet";
  };
  const describe = (m: BundleMeasurement) => {
    const layer = m.layer?.trim() || "(unlabeled)";
    const val = m.value == null ? "?" : m.value.toFixed(1);
    let extra = "";
    if (m.type === "wall")
      extra = ` [wall h=${m.wall_height ?? "?"}ft, ${m.wall_sided ?? "single"}-sided]`;
    if (m.type === "volume")
      extra = ` [${m.vol_mode ?? "linear"}, w=${m.vol_width ?? "-"} d=${m.vol_depth ?? "?"}ft]`;
    return `  - ${m.type} "${layer}": ${val} ${m.unit ?? ""}${extra} (on ${sheetName(m.sheet_id)})`;
  };
  if (!bundle.measurements.length)
    return "The user has not recorded any measurements yet.";
  return [
    "Takeoff drivers measured by the user:",
    ...bundle.measurements.map(describe),
  ].join("\n");
}

function notesText(bundle: ScopeBundle): string {
  const parts: string[] = [];
  if (bundle.project.project_type)
    parts.push(`Project type: ${bundle.project.project_type}`);
  if (bundle.project.address) parts.push(`Address: ${bundle.project.address}`);
  if (bundle.project.notes) parts.push(`Project notes: ${bundle.project.notes}`);
  for (const s of bundle.sheets) {
    if (s.notes?.trim())
      parts.push(
        `Notes on ${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""}: ${s.notes.trim()}`,
      );
  }
  return parts.length ? parts.join("\n") : "No additional notes.";
}

// Upload the plan PDFs once via the Files API (avoids the request-size limit
// you hit when inlining big PDFs). Memory-frugal: download and upload ONE file
// at a time as a Blob (no base64 string, no extra Buffer copy), so peak memory
// is a single plan file — not the sum of all of them. Returns the file IDs.
export async function uploadPlanFiles(
  sb: SupabaseClient,
  bundle: ScopeBundle,
  signal?: AbortSignal,
): Promise<string[]> {
  const client = getAnthropicClient();
  const ids: string[] = [];
  for (const p of bundle.plans) {
    if (signal?.aborted) break;
    const { data: blob } = await sb.storage.from("plans").download(p.storage_path);
    if (!blob) continue;
    const srcBytes = new Uint8Array(await blob.arrayBuffer());

    // Build a small sub-PDF of ONLY the image-only pages that need a vision read
    // (capped to the page limit). This keeps us under Anthropic's PDF limits even
    // when the full plan set is hundreds of MB. Falls back to the file as-is.
    let outBytes = srcBytes;
    try {
      const wanted = (p.pages ?? []).map((n) => n - 1).filter((i) => i >= 0);
      if (wanted.length) {
        const src = await PDFDocument.load(srcBytes);
        const total = src.getPageCount();
        const idx = wanted.filter((i) => i < total).slice(0, MAX_PDF_PAGES);
        if (idx.length && idx.length < total) {
          const out = await PDFDocument.create();
          (await out.copyPages(src, idx)).forEach((pg) => out.addPage(pg));
          outBytes = new Uint8Array(await out.save());
        }
      }
    } catch {
      outBytes = srcBytes; // extraction failed — try the whole file (cap still applies)
    }

    // If it's still over the model's limit, skip the vision read rather than
    // failing the whole run — the AI drafts from text + measurements instead.
    if (outBytes.length > MAX_PDF_BYTES) continue;

    const uploaded = await client.beta.files.upload(
      {
        file: await toFile(outBytes, p.file_name, { type: "application/pdf" }),
        betas: [FILES_BETA],
      },
      { signal },
    );
    ids.push(uploaded.id);
  }
  return ids;
}

export async function deletePlanFiles(fileIds: string[]): Promise<void> {
  const client = getAnthropicClient();
  for (const id of fileIds) {
    try {
      await client.beta.files.delete(id, { betas: [FILES_BETA] });
    } catch {}
  }
}

// Reference uploaded PDFs by file_id as document blocks. The LAST document
// carries a cache breakpoint, so the plan drawings are cached once and reused
// by every draft chunk AND the review pass (read at ~10% cost) instead of being
// re-billed on each call.
function planBlocks(fileIds: string[]) {
  return fileIds.map((id, i) => ({
    type: "document" as const,
    source: { type: "file" as const, file_id: id },
    ...(i === fileIds.length - 1
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));
}

// The user's answers to earlier AI questions — authoritative; don't re-ask.
function clarificationsText(bundle: ScopeBundle): string {
  if (!bundle.clarifications.length) return "";
  return [
    "USER CLARIFICATIONS — the user answered these questions. Treat each answer as AUTHORITATIVE, apply it to the scope/quantities, and do NOT ask it again:",
    ...bundle.clarifications.map((c) => `  Q: ${c.question}\n  A: ${c.answer}`),
  ].join("\n");
}

function planContentText(bundle: ScopeBundle): string {
  if (!bundle.planText.trim())
    return "PLAN CONTENT: (no text extracted — read the attached sheet images.)";
  return `PLAN CONTENT (text extracted from the drawings — schedules, general notes, callouts):\n${bundle.planText}`;
}

function renderSheetDocs(docs: ScopeBundle["sheetDocs"]): string {
  return docs
    .map((s) => {
      const title = `${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""} [${s.discipline}]`;
      return `=== ${title} ===\n${s.text}`;
    })
    .join("\n\n");
}

// CORE plan text — the shared reference sheets (cover, general notes, schedules,
// all architectural) sent to EVERY division chunk. Identical across chunks, so
// it sits in the cached block and every chunk reads it at ~10% cost.
function coreContentText(bundle: ScopeBundle): string {
  const core = bundle.sheetDocs.filter((s) => s.is_core);
  if (!core.length)
    return "PLAN CONTENT: (no text extracted — read the attached sheet images.)";
  return `PLAN CONTENT — shared reference sheets (cover, general notes, schedules, architectural):\n${renderSheetDocs(core)}`;
}

// Discipline-specific plan text routed to THIS chunk's divisions only — e.g. the
// structural sheets for the concrete chunk, the MEP sheets for the plumbing/HVAC
// chunk. Keeps each division from wading through unrelated disciplines' sheets.
function chunkContentText(bundle: ScopeBundle, trades: string[]): string {
  const routed = routedDisciplines(trades);
  const extra = bundle.sheetDocs.filter(
    (s) => !s.is_core && (routed === null || routed.has(s.discipline)),
  );
  if (!extra.length) return "";
  return `PLAN CONTENT — sheets specific to these trades:\n${renderSheetDocs(extra)}`;
}

// Limit the scope to chosen trades, or the whole building when none are chosen.
function scopeFocusText(trades: string[]): string {
  if (!trades.length)
    return "SCOPE FOCUS: the FULL building — every trade / CSI division.";
  return `SCOPE FOCUS: generate ONLY these trades / CSI divisions and NOTHING else: ${trades.join(
    ", ",
  )}. Within these trades be fully comprehensive (cover everything, count schedules, propose quantities). Do NOT include line items from any other division.`;
}

function textFromResponse(content: unknown[]): string {
  for (const block of content as { type: string; text?: string }[]) {
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}

// Stream a structured-output request and return the full JSON text. Streaming
// lets us use a large max_tokens without HTTP timeouts.
async function streamStructured(
  params: Parameters<
    ReturnType<typeof getAnthropicClient>["beta"]["messages"]["stream"]
  >[0],
  signal?: AbortSignal,
): Promise<string> {
  const client = getAnthropicClient();
  const stream = client.beta.messages.stream(params, { signal });
  const msg = await stream.finalMessage();
  return textFromResponse(msg.content);
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Part of the ${what} came back incomplete. Click Generate again — it usually completes on a retry.`,
    );
  }
}

// Full-building generation runs in division-sized chunks so no single AI
// response can grow big enough to get cut off. Each chunk is a complete,
// bounded draft of related trades; run.ts merges them.
export const FULL_BUILDING_CHUNKS: string[][] = [
  [
    "01 General Requirements",
    "02 Existing Conditions / Demolition",
    "31 Earthwork / Sitework",
    "32 Exterior Improvements",
    "33 Utilities",
  ],
  ["03 Concrete", "04 Masonry", "05 Metals"],
  [
    "06 Wood & Plastics (framing)",
    "07 Thermal & Moisture (roofing/insulation/waterproofing)",
    "08 Openings (doors & windows)",
  ],
  [
    "09 Finishes",
    "10 Specialties",
    "11 Equipment",
    "12 Furnishings",
    "14 Conveying Equipment (elevators)",
  ],
  ["21 Fire Suppression", "22 Plumbing", "23 HVAC"],
  ["26 Electrical", "27 Communications", "28 Electronic Safety & Security"],
];

/** Split a run into chunks: the standard full-building chunks, or the user's
 *  selected trades in groups of three. */
export function chunkTrades(trades: string[]): string[][] {
  if (!trades.length) return FULL_BUILDING_CHUNKS;
  const out: string[][] = [];
  for (let i = 0; i < trades.length; i += 3) out.push(trades.slice(i, i + 3));
  return out;
}

// Pass 1 — Sonnet draft: bloom the takeoff drivers into a full CSI scope.
export async function draftScope(
  bundle: ScopeBundle,
  fileIds: string[],
  trades: string[] = [],
  signal?: AbortSignal,
): Promise<{
  lineItems: GeneratedLineItem[];
  findings: GeneratedFinding[];
}> {
  const text = await streamStructured(
    {
      model: DRAFT_MODEL,
      max_tokens: 48000,
      betas: [FILES_BETA],
      output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            // 1) Plan drawings — cached, shared by every draft chunk + the review.
            ...planBlocks(fileIds),
            // 2) Project-level context + rules + the shared CORE sheets —
            //    identical across the 6 chunks, so cache it; chunks 2-6 read it
            //    instead of re-sending. Discipline-specific sheets are routed in
            //    block 3 (per chunk) to keep this cache prefix stable.
            {
              type: "text",
              text: `${COMPANY_CONTEXT}\n\n${RULES}\n\n${clarificationsText(bundle)}\n\n${notesText(bundle)}\n\n${takeoffText(bundle)}\n\n${coreContentText(bundle)}`,
              cache_control: { type: "ephemeral" as const },
            },
            // 3) Chunk-specific content: the sheets routed to this chunk's
            //    disciplines, plus the taxonomy + instructions (varies per call).
            {
              type: "text",
              text: [
                scopeFocusText(trades),
                chunkContentText(bundle, trades),
                taxonomyPromptText(trades),
                `Using the plan content and STANDARD SUBCATEGORIES above, produce the COMPLETE, COMPREHENSIVE scope of work as line_items organized by CSI division and those subcategories. Cover ALL trades the plans show or that this building type requires — not only the areas the user measured. Fold the door/window/finish schedule counts into the matching subcategory lines, and propose quantities (with formula + assumptions) wherever the user gave no measurement. Also return any assumptions/exclusions you relied on as findings.`,
              ]
                .filter((s) => s.trim())
                .join("\n\n"),
            },
          ],
        },
      ],
    },
    signal,
  );
  const draft = parseJson<{
    line_items: GeneratedLineItem[];
    findings: GeneratedFinding[];
  }>(text, "scope draft");
  return {
    lineItems: draft.line_items ?? [],
    findings: draft.findings ?? [],
  };
}

// Pass 2 — Opus second-opinion / gap-finder over the draft + plans.
export async function findGaps(
  bundle: ScopeBundle,
  draftLineItems: GeneratedLineItem[],
  fileIds: string[],
  trades: string[] = [],
  signal?: AbortSignal,
): Promise<GeneratedFinding[]> {
  const draftSummary = draftLineItems
    .map(
      (li) =>
        `${li.division_code} ${li.division_name} — ${li.description}${li.quantity != null ? ` (${li.quantity} ${li.unit ?? ""})` : ""}`,
    )
    .join("\n");

  const text = await streamStructured(
    {
      model: CRITIQUE_MODEL,
      max_tokens: 16000,
      betas: [FILES_BETA],
      output_config: { format: { type: "json_schema", schema: FINDINGS_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            // Plan drawings first → reuse the cache written during the draft.
            ...planBlocks(fileIds),
            {
              type: "text",
              text: `${COMPANY_CONTEXT}\n\nA draft scope was generated from the user's takeoff and the attached plans. Act as a senior estimator giving it a final review. Report ONLY the things that genuinely matter to a bid — be selective, not exhaustive. A short list of real issues is far more useful than a long list of nitpicks.\n\nHARD LIMITS: return at most 6 findings TOTAL, and at most 3 of kind "question". Every finding's "text" is ONE short line (≤ ~15 words), never a paragraph. Only HIGH/MEDIUM cost impact; consolidate related points; if the draft is solid, return very few.\n\nFinding kinds:\n- "gap": real, cost-significant work drawn/implied but missing (e.g. "3 baths, no plumbing fixtures scoped").\n- "exclusion": owner-furnished / out-of-contract items to call out.\n- "question": a genuinely ambiguous, cost-moving decision. For EACH question also fill "options": 2–4 very short answer choices, most-likely FIRST (e.g. ["4-inch","6-inch"] or ["In contract","By owner"]).\n- "assumption": a load-bearing assumption that materially changes the price if wrong.\nFor every non-question finding set "options" to []. Be specific, reference sheets where possible, set severity high/medium/low (rarely "low"). Do NOT re-ask anything already answered in the USER CLARIFICATIONS below.\n\n${scopeFocusText(trades)}\n\n${clarificationsText(bundle)}\n\n${notesText(bundle)}\n\n${takeoffText(bundle)}\n\n${planContentText(bundle)}\n\nDRAFT SCOPE:\n${draftSummary}`,
            },
          ],
        },
      ],
    },
    signal,
  );
  const critique = parseJson<{ findings: GeneratedFinding[] }>(
    text,
    "review findings",
  );
  return critique.findings ?? [];
}
