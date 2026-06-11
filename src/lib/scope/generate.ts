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
import { getAnthropicClient } from "@/lib/anthropic";
import type { ScopeBundle, BundleMeasurement } from "./bundle";

// Draft = Fable 5 (best plan-reading/reasoning); review = Opus 4.8 so the
// second opinion comes from a genuinely different model.
const DRAFT_MODEL = "claude-fable-5";
const CRITIQUE_MODEL = "claude-opus-4-8";
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
};

const COMPANY_CONTEXT = `XtraUnit is a licensed California general contractor (CA #1033830) that prices ALL trades on a job — site work, concrete, framing, MEP, finishes, etc. You are preparing a scope of work for the XtraUnit estimating team.`;

const RULES = `Critical rules:
- COMPREHENSIVE COVERAGE IS REQUIRED. Scope the ENTIRE project the way a general contractor bidding ALL trades would: every trade and CSI division the plans show, PLUS everything a building of this type normally requires (sitework, demo, concrete/foundations, framing, roofing, doors/windows, insulation, drywall, finishes, plumbing, HVAC, electrical, fire protection, specialties, etc.). Aim for thorough, not minimal.
- READ THE DIMENSIONS. The plan content includes dimension strings, grid spacings, ceiling heights, and other numbers printed on the drawings — use them, together with the user's takeoff measurements, as the AUTHORITATIVE basis for every quantity you propose. When a printed dimension and your visual estimate disagree, the printed dimension wins; when the user's measurement and anything else disagree, the user's measurement wins.
- The user's measurements are ANCHORS, NOT LIMITS. Do NOT restrict the scope to only the areas the user measured. Measured areas should be richer/higher-confidence, but you must ALSO scope everything else in the plans even when the user gave no measurement for it.
- For work with no user measurement, you MUST still include the scope line and PROPOSE the quantity yourself — read the plans, COUNT items in the schedules, and estimate from dimensions/areas. Never omit a needed scope line just because the user didn't measure it. If you truly can't put a number, include the line with quantity null and a note, but always include the line.
- COUNT THE SCHEDULES. Read every schedule on the plans (door schedule, window schedule, finish schedule, fixture/equipment schedules) and produce counted line items from them — e.g. count each door type in the door schedule (3070 ×4, 3068 ×6 …) and total them, same for windows. Do this even though the user did not measure doors/windows.
- Every quantity you provide is a PROPOSAL the user will check. Show your work: set "formula" (e.g. "door schedule: 4+6+2 = 12 doors", or "2400 sf slab × 4in ÷ 27 = 35.6 cy") and list "assumptions". Set source_kind to "takeoff" (user measured), "derived" (computed from a measurement), "ai_measured" (you counted/measured it off the drawing or schedule), "schedule", "note", "drawing", or "assumption".
- Do NOT split Builder's vs Owner's cost. Owner-furnished or out-of-contract items go in findings as an "exclusion".
- Never invent prices — no costs at all in this phase.
- ASK QUESTIONS. Whenever a user's answer would materially improve a quantity or a scope decision (slab thickness, wall height, roof/finish materials, demolition in scope?, insulation R-value, fixture specs, etc.), add a finding with kind "question". Prefer asking over silently assuming.
- Use CSI MasterFormat divisions (e.g. 03 Concrete, 06 Wood/Plastics/Composites, 08 Openings, 09 Finishes, 22 Plumbing, 23 HVAC, 26 Electrical). division_code is the 2-digit number, division_name the title.
- ALWAYS assign the CSI SECTION under the division: section_code is the standard 6-digit MasterFormat section written "06 10 00", section_name its title ("Rough Carpentry"). Group related work under the same section — e.g. 03 30 00 Cast-in-Place Concrete, 06 10 00 Rough Carpentry, 07 21 00 Thermal Insulation, 08 11 00 Metal Doors and Frames, 09 29 00 Gypsum Board, 22 40 00 Plumbing Fixtures. Never leave section_code/section_name null.
- FORMAT EVERY DESCRIPTION THE SAME WAY, one work item per line: "<Action> <item with specification> — <location/extent>". Use ONLY these action openers: "Furnish and install", "Supply only", "Install only", "Demolish and remove", "Excavate", "Place and finish", "Apply", "Rough-in", "Provide allowance for". Include the spec (size, grade, spacing, thickness, rating) and the location/extent after the em dash.
  Examples of the required style:
    "Furnish and install 2x6 DFL studs @ 16\\" o.c. — exterior walls, floors 1–3"
    "Furnish and install 2x12 DFL floor joists @ 16\\" o.c. — 2nd & 3rd floor framing"
    "Place and finish 4\\" concrete slab on grade w/ #4 rebar @ 18\\" o.c. e.w. — ground floor"
    "Furnish and install 3070 solid-core wood doors w/ frames & hardware — units, per door schedule"
  Never write narrative sentences, observations, or explanations in description — that material belongs in evidence_text or assumptions.
- Within each section, order line items in construction sequence: below-grade → structure → exterior shell → interior, lower floors before upper floors.
- Use the SAME wording for the same work item on every project — consistent phrasing is required so past prices can be matched to future jobs.
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
        },
        required: ["kind", "text", "severity"],
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
        },
        required: ["kind", "text", "severity"],
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
// you hit when inlining big PDFs as base64). Returns the file IDs.
export async function uploadPlanFiles(
  bundle: ScopeBundle,
  signal?: AbortSignal,
): Promise<string[]> {
  const client = getAnthropicClient();
  const ids: string[] = [];
  for (const p of bundle.plans) {
    const uploaded = await client.beta.files.upload(
      {
        file: await toFile(Buffer.from(p.base64, "base64"), p.file_name, {
          type: "application/pdf",
        }),
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

// Reference uploaded PDFs by file_id as document blocks.
function planBlocks(fileIds: string[]) {
  return fileIds.map((id) => ({
    type: "document" as const,
    source: { type: "file" as const, file_id: id },
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
      `The AI's ${what} was too long and got cut off before it finished. Try again, or split this into a smaller plan set.`,
    );
  }
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
          {
            type: "text",
            text: `${COMPANY_CONTEXT}\n\n${RULES}\n\n${scopeFocusText(trades)}\n\n${clarificationsText(bundle)}\n\n${notesText(bundle)}\n\n${takeoffText(bundle)}\n\n${planContentText(bundle)}\n\nUsing the plan content above (and any attached image-only sheets), produce the COMPLETE, COMPREHENSIVE scope of work as line_items organized by CSI division. Cover ALL trades the plans show or that this building type requires — not only the areas the user measured. Count the door/window/finish schedules into line items, and propose quantities (with formula + assumptions) wherever the user gave no measurement. Also return any assumptions/exclusions you relied on as findings.`,
          },
          ...planBlocks(fileIds),
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
          {
            type: "text",
            text: `${COMPANY_CONTEXT}\n\nA draft scope was generated from the user's takeoff and the attached plans. Act as a second estimator reviewing it. Find what is MISSING or UNCLEAR. Return findings only:\n- kind "gap": work that is drawn/implied but not in the draft, or a driver the user should measure (e.g. "floor plan shows 3 baths but no plumbing fixtures are scoped").\n- kind "assumption": an assumption the draft depends on that should be confirmed.\n- kind "exclusion": owner-furnished / out-of-contract items to call out.\n- kind "question": anything genuinely ambiguous in the documents.\nBe specific and reference sheets where possible. severity is high/medium/low. Do NOT re-ask anything already answered in the USER CLARIFICATIONS below.\n\n${scopeFocusText(trades)}\n\n${clarificationsText(bundle)}\n\n${notesText(bundle)}\n\n${takeoffText(bundle)}\n\n${planContentText(bundle)}\n\nDRAFT SCOPE:\n${draftSummary}`,
          },
          ...planBlocks(fileIds),
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
