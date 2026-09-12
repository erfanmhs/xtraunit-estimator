import "server-only";

/**
 * AI symbol count — the second opinion. The viewer renders ONE sheet to a
 * JPEG; Claude looks at it and reports what it can count (doors, windows,
 * plumbing fixtures, light fixtures, receptacles, columns…) with a rough
 * position for each mark, in fractions of the image. The viewer turns those
 * into editable count markers. Never silently trusted: the user sees the
 * counts next to their own and places them only if they want to.
 */
import { getAnthropicClient } from "@/lib/anthropic";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-meter";
import { AI_MODELS } from "@/config/ai";

const COUNT_MODEL = AI_MODELS.count;

export type AiCountKind = {
  /** Short plural label as it should read on the layer: "Doors", "Windows". */
  kind: string;
  count: number;
  /** One mark per counted item, 0–1 of image width / height. Length should equal count. */
  positions: { x: number; y: number }[];
  /** How sure the model is, 0–1. */
  confidence: number;
  /** One line: what it counted and what it left out. */
  note: string;
};

export type AiCountResult = {
  kinds: AiCountKind[];
  /** What kind of sheet this appears to be (floor plan, elevation, schedule…). */
  sheet_read: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    sheet_read: { type: "string" },
    kinds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          count: { type: "integer" },
          positions: {
            type: "array",
            items: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
              additionalProperties: false,
            },
          },
          confidence: { type: "number" },
          note: { type: "string" },
        },
        required: ["kind", "count", "positions", "confidence", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["sheet_read", "kinds"],
  additionalProperties: false,
} as const;

export async function countSymbolsOnSheet(opts: {
  jpegBase64: string;
  sheetName: string | null;
  /** What the user wants counted, if they said; otherwise everything countable. */
  wanted?: string[];
}): Promise<AiCountResult> {
  assertAiBudget();
  const client = getAnthropicClient();
  const focus = opts.wanted?.length
    ? `Count these kinds: ${opts.wanted.join(", ")}. Report other countable kinds too if they are clearly present.`
    : `Count every kind of repeated symbol that a construction estimator would count.`;

  const prompt = `This is one sheet of a construction drawing set${opts.sheetName ? ` ("${opts.sheetName}")` : ""}. ${focus}

Typical kinds: doors (each swing symbol), windows (each window symbol in a wall), plumbing fixtures (toilets, sinks, tubs, showers — as one kind or split if clear), light fixtures, receptacles/outlets, switches, columns, grid bubbles, HVAC registers/diffusers, sprinkler heads.

Rules:
- Count only what is drawn on the plan itself — not the legend, not the title block, not schedules or notes.
- For EVERY item you count, give its position as x and y fractions of the image (0 = left/top, 1 = right/bottom), at the centre of the symbol. positions.length must equal count.
- Skip a kind rather than guess: if fewer than 2 are clearly visible, leave it out.
- confidence: 0.9 for clean CAD symbols you can see clearly; 0.5 if the drawing is dense, small, or scanned.
- note: one short line — what you counted and anything you deliberately left out ("closet bifolds counted as doors; the cased opening at the kitchen not counted").
- sheet_read: what this sheet is (e.g. "first floor plan", "roof plan", "electrical plan", "not a plan — a schedule/detail sheet").

Kind names: short plural, capitalised, no parentheses — "Doors", "Windows", "Plumbing fixtures", "Light fixtures", "Receptacles", "Columns".`;

  const stream = client.beta.messages.stream({
    model: COUNT_MODEL,
    max_tokens: 6000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: opts.jpegBase64 },
          },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  recordAiUsage(COUNT_MODEL, msg.usage, "aicount");
  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? (textBlock.text as string) : null;
  if (!text) throw new Error("The AI returned nothing — try again.");
  let parsed: AiCountResult;
  try {
    parsed = JSON.parse(text) as AiCountResult;
  } catch {
    throw new Error("The AI's answer could not be read. Try again.");
  }
  // Keep the data honest: positions inside the image, count = marks given.
  parsed.kinds = (parsed.kinds ?? [])
    .map((k) => {
      const positions = (k.positions ?? []).filter(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1,
      );
      return { ...k, positions, count: positions.length || k.count, confidence: Math.max(0, Math.min(1, k.confidence ?? 0.5)) };
    })
    .filter((k) => k.count > 0);
  return parsed;
}
