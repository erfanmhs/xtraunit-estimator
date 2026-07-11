import "server-only";

/**
 * Apply the estimator's finding responses to the EXISTING scope — cheaply.
 *
 * Instead of re-reading every plan and redrafting all six divisions (a full
 * regenerate), this takes the current scope + the user's decisions (answered
 * questions, accepted assumptions/gaps/exclusions with notes) + the cheap cached
 * plan text, and asks the AI for ONLY the targeted edits: lines to add, lines to
 * update by id, and lines to exclude by id. One small call, no vision, no chunks.
 */
import { getAnthropicClient } from "@/lib/anthropic";
import { AI_MODELS } from "@/config/ai";

const APPLY_MODEL = AI_MODELS.scopeDraft; // Opus — accuracy matters; call is small

export type CurrentLine = {
  id: string;
  division_code: string | null;
  division_name: string | null;
  section_code: string | null;
  section_name: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  status: string | null;
};

export type FindingResponse = {
  kind: string; // question | gap | assumption | exclusion
  text: string;
  note: string; // the user's answer/correction ("" for a bare Accept)
};

export type ScopeChanges = {
  additions: {
    division_code: string;
    division_name: string;
    section_code: string | null;
    section_name: string | null;
    description: string;
    quantity: number | null;
    unit: string | null;
    formula: string | null;
    assumptions: string[];
  }[];
  updates: {
    id: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  }[];
  exclusions: string[]; // existing line ids to mark excluded
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    additions: {
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
          formula: { type: ["string", "null"] },
          assumptions: { type: "array", items: { type: "string" } },
        },
        required: [
          "division_code",
          "division_name",
          "section_code",
          "section_name",
          "description",
          "quantity",
          "unit",
          "formula",
          "assumptions",
        ],
      },
    },
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          description: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
        },
        required: ["id", "description", "quantity", "unit"],
      },
    },
    exclusions: { type: "array", items: { type: "string" } },
  },
  required: ["additions", "updates", "exclusions"],
} as const;

const RULES = `You are updating an EXISTING construction scope of work to reflect the estimator's decisions on review findings. Make ONLY the minimal edits those decisions require. Do NOT rewrite, re-derive, or restate the rest of the scope.

How to map each decision:
- Answered QUESTION or accepted ASSUMPTION with a correction: UPDATE the affected existing line(s) — reference their exact id — to match (adjust quantity/description/unit). If it clearly implies work not yet scoped, ADD the line(s).
- Accepted GAP: ADD the missing scope line(s) it describes (read the plan text / schedules for counts and specs).
- Accepted EXCLUSION: add the id of the matching existing line(s) to "exclusions". If nothing matches, do nothing.
- Every ADDED line needs a CSI division_code (2-digit) + division_name, a 6-digit section_code + section_name, and a short standard-style description. Put your math in "formula" and any assumptions in "assumptions".
- Only touch ids that appear in the current scope below. Be conservative: if a decision doesn't clearly map to a change, skip it. Return empty arrays if nothing needs to change.`;

function linesText(lines: CurrentLine[]): string {
  return lines
    .map(
      (l) =>
        `[${l.id}] ${l.division_code ?? "??"} ${l.division_name ?? ""} · ${l.section_code ?? ""} — ${l.description}${
          l.quantity != null ? ` (${l.quantity} ${l.unit ?? ""})` : ""
        }${l.status && l.status !== "proposed" ? ` [${l.status}]` : ""}`,
    )
    .join("\n");
}

function findingsText(findings: FindingResponse[]): string {
  return findings
    .map((f) => {
      const note = f.note.trim() ? `\n   → the estimator says: ${f.note.trim()}` : " (accepted as-is)";
      return `- (${f.kind}) ${f.text}${note}`;
    })
    .join("\n");
}

function parseJson(text: string): ScopeChanges {
  try {
    const p = JSON.parse(text) as Partial<ScopeChanges>;
    return {
      additions: p.additions ?? [],
      updates: p.updates ?? [],
      exclusions: p.exclusions ?? [],
    };
  } catch {
    throw new Error(
      "The update came back incomplete — please click Apply again.",
    );
  }
}

export async function applyFindingsToScope(input: {
  lines: CurrentLine[];
  findings: FindingResponse[];
  planText: string;
  signal?: AbortSignal;
}): Promise<ScopeChanges> {
  const { lines, findings, planText, signal } = input;
  const client = getAnthropicClient();

  const planBlock = planText.trim()
    ? `PLAN CONTENT (text from the drawings — schedules, notes, callouts, for looking up counts/specs when a decision needs one):\n${planText.slice(0, 60000)}`
    : "PLAN CONTENT: (none extracted.)";

  const stream = client.beta.messages.stream(
    {
      model: APPLY_MODEL,
      max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: `${RULES}\n\nCURRENT SCOPE (each line is "[id] division section — description (qty unit)"):\n${linesText(
            lines,
          )}\n\nTHE ESTIMATOR'S DECISIONS TO APPLY:\n${findingsText(findings)}\n\n${planBlock}\n\nReturn the targeted changes (additions / updates by id / exclusions by id) only.`,
        },
      ],
    },
    { signal },
  );
  const msg = await stream.finalMessage();
  let text = "";
  for (const block of msg.content as { type: string; text?: string }[]) {
    if (block.type === "text" && typeof block.text === "string") {
      text = block.text;
      break;
    }
  }
  return parseJson(text);
}
