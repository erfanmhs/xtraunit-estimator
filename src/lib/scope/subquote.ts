import "server-only";

/**
 * AI sub-quote reading: the user uploads a trade partner's quote (PDF or
 * photo); Claude reads it and extracts who/what/how much — sub name, trade,
 * CSI divisions covered, date, total, line breakdown, inclusions/exclusions.
 * The user reviews the extraction before anything is applied.
 */
import { getAnthropicClient } from "@/lib/anthropic";

import { AI_MODELS } from "@/config/ai";

const QUOTE_MODEL = AI_MODELS.quoteRead;

export type QuoteExtraction = {
  sub_name: string;
  trade: string;
  division_codes: string[];
  quote_date: string | null;
  total: number;
  line_items: { description: string; amount: number | null }[];
  inclusions: string[];
  exclusions: string[];
  summary: string;
};

const QUOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sub_name: { type: "string" },
    trade: { type: "string" },
    division_codes: { type: "array", items: { type: "string" } },
    quote_date: { type: ["string", "null"] },
    total: { type: "number" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          amount: { type: ["number", "null"] },
        },
        required: ["description", "amount"],
      },
    },
    inclusions: { type: "array", items: { type: "string" } },
    exclusions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "sub_name",
    "trade",
    "division_codes",
    "quote_date",
    "total",
    "line_items",
    "inclusions",
    "exclusions",
    "summary",
  ],
} as const;

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export async function readSubQuote(opts: {
  base64: string;
  mime: string;
  fileName: string;
}): Promise<QuoteExtraction> {
  const { base64, mime, fileName } = opts;
  const client = getAnthropicClient();

  const docBlock = IMAGE_TYPES.has(mime)
    ? {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64,
        },
      }
    : {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: base64,
        },
      };

  const prompt = `This is a subcontractor's quote/bid document ("${fileName}") received by XtraUnit, a California general contractor. Read it carefully and extract:
- sub_name: the subcontractor company's name.
- trade: the trade in plain language (e.g. "Plumbing", "Roofing", "Electrical").
- division_codes: the 2-digit CSI MasterFormat division(s) this quote covers (e.g. ["22"] for plumbing, ["23"] HVAC, ["26"] electrical, ["07"] roofing/insulation, ["03"] concrete, ["06"] framing, ["09"] finishes, ["21"] fire suppression, ["31"] earthwork, ["32"] exterior improvements).
- quote_date: the date printed on the quote, as written (null if none).
- total: the bottom-line quote amount in dollars (the number the sub is asking for). If multiple options/alternates exist, use the base bid and mention alternates in summary.
- line_items: the quote's own cost breakdown if it shows one (description + dollar amount per item; amount null if not priced individually). Empty array if it's one lump number.
- inclusions: what the quote explicitly includes.
- exclusions: what it explicitly excludes (these matter — they become the GC's risk).
- summary: 1–2 plain sentences: who quoted what for how much, plus anything unusual (alternates, allowances, expiration date, payment terms).
Read every number carefully. If the document is not a quote at all, say so in summary and set total to 0.`;

  const stream = client.beta.messages.stream({
    model: QUOTE_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: QUOTE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, docBlock],
      },
    ],
  });
  const msg = await stream.finalMessage();
  const textBlock = msg.content.find((b) => b.type === "text");
  const text =
    textBlock && "text" in textBlock ? (textBlock.text as string) : null;
  if (!text) throw new Error("The AI returned nothing — try again.");
  try {
    return JSON.parse(text) as QuoteExtraction;
  } catch {
    throw new Error("Could not read the quote document. Try a clearer copy.");
  }
}
