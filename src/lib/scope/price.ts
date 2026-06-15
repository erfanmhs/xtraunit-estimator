import "server-only";

/**
 * Phase 9 — AI price suggestions.
 *
 * One structured call (no PDFs needed): the scope lines + project context +
 * the user's cost history go in; five-bucket direct costs come back, one per
 * line. Everything returned is a PROPOSAL (price_status 'proposed') the user
 * edits/confirms/deletes on the Pricing page. Rules:
 *   - DIRECT COST ONLY — never overhead, profit, contingency, insurance.
 *   - The user's own cost history is preferred over market knowledge.
 *   - Confirmed prices are never overwritten.
 */
import { createClient as createSb } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "@/lib/anthropic";
import { findBestMatch } from "./match";

import { AI_MODELS } from "@/config/ai";

const PRICING_MODEL = AI_MODELS.pricing;

type PriceableLine = {
  id: string;
  division_code: string | null;
  division_name: string | null;
  section_code: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  evidence: { formula?: string | null; assumptions?: string[] | null } | null;
  price_status: string | null;
};

type HistoryRow = {
  division_code: string | null;
  section_code?: string | null;
  description: string;
  unit: string | null;
  price_mode: string | null;
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
  price_note: string | null;
  created_at: string;
};

export type SuggestedPrice = {
  id: string;
  price_mode: string; // 'unit' | 'lump'
  labor: number;
  material: number;
  subcontractor: number;
  equipment: number;
  other: number;
  basis: string; // 'history' | 'market'
  confidence: string; // high | medium | low
  note: string;
};

const PRICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          price_mode: { type: "string", enum: ["unit", "lump"] },
          labor: { type: "number" },
          material: { type: "number" },
          subcontractor: { type: "number" },
          equipment: { type: "number" },
          other: { type: "number" },
          basis: { type: "string", enum: ["history", "market"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string" },
        },
        required: [
          "id",
          "price_mode",
          "labor",
          "material",
          "subcontractor",
          "equipment",
          "other",
          "basis",
          "confidence",
          "note",
        ],
      },
    },
  },
  required: ["prices"],
} as const;

function historyText(rows: HistoryRow[]): string {
  if (!rows.length)
    return "COST HISTORY: empty — this is the user's first priced job. Use market knowledge for everything (basis 'market').";
  const lines = rows.map((r) => {
    const buckets =
      r.cost_total != null
        ? `TOTAL=${r.cost_total}`
        : `L=${r.cost_labor ?? 0} M=${r.cost_material ?? 0} S=${r.cost_sub ?? 0} E=${r.cost_equipment ?? 0} O=${r.cost_other ?? 0}`;
    return `  - [div ${r.division_code ?? "?"}] ${r.description} (${r.price_mode ?? "unit"}, per ${r.unit ?? "ls"}): ${buckets}${r.price_note ? ` — ${r.price_note}` : ""}`;
  });
  return [
    "COST HISTORY (the user's own confirmed prices from past work — PREFER these; when you use one, set basis 'history' and reference it in the note):",
    ...lines,
  ].join("\n");
}

function linesText(lines: PriceableLine[]): string {
  return lines
    .map((li) => {
      const qty =
        li.quantity != null ? `${li.quantity} ${li.unit ?? ""}` : "no quantity";
      const extra = [
        li.evidence?.formula ? `formula: ${li.evidence.formula}` : null,
        li.evidence?.assumptions?.length
          ? `assumes: ${li.evidence.assumptions.join("; ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `  - id=${li.id} [div ${li.division_code ?? "?"} ${li.division_name ?? ""}] ${li.description} — ${qty}${extra ? ` (${extra})` : ""}`;
    })
    .join("\n");
}

export async function suggestPrices(opts: {
  project: {
    name: string | null;
    address: string | null;
    project_type: string | null;
  };
  clarifications: { question: string; answer: string }[];
  lines: PriceableLine[];
  history: HistoryRow[];
  signal?: AbortSignal;
}): Promise<SuggestedPrice[]> {
  const { project, clarifications, lines, history, signal } = opts;
  const client = getAnthropicClient();

  const claText = clarifications.length
    ? `USER CLARIFICATIONS (authoritative):\n${clarifications.map((c) => `  Q: ${c.question}\n  A: ${c.answer}`).join("\n")}`
    : "";

  const prompt = `XtraUnit is a licensed California general contractor (CA #1033830) pricing all trades. Suggest DIRECT COSTS for each scope line below. A senior estimator will review every number — these are proposals, not final prices.

Critical rules:
- DIRECT COST ONLY. Never include overhead, profit, contingency, insurance, or bond — markups are applied separately later.
- Split each line's cost into five buckets: labor, material, subcontractor, equipment, other. Use 0 for buckets that don't apply.
- Bucket logic: licensed specialty trades a GC typically subcontracts (plumbing, HVAC, electrical, fire suppression, roofing, elevators) → put the sub's full price in "subcontractor". Trades a GC commonly self-performs (demo, concrete, framing, drywall, finishes, sitework) → split into labor + material (+ equipment where real). If the cost history shows how this user buys a trade, follow the history instead.
- price_mode: use "unit" ($/unit rates; line total = quantity × sum of buckets) when the line has a quantity and unit. Use "lump" (totals in $) only when it has no usable quantity.
- Price for the project's location and current market conditions.
- basis: "history" when anchored to the user's cost history below, otherwise "market". confidence: "high" only when anchored to history or a very standard item; "medium" for normal market pricing; "low" for rough allowances.
- note: one short line saying where the number comes from (e.g. "market rate, LA multifamily" or "from your Erwin St drywall price").
- Return one entry per line, using the exact id given. Do not skip lines — if you truly cannot price one, return zeros with confidence "low" and say why in the note.

PROJECT: ${project.name ?? "Unnamed"} — ${project.project_type ?? "type unknown"} at ${project.address ?? "address unknown"}.

${claText}

${historyText(history)}

SCOPE LINES TO PRICE:
${linesText(lines)}`;

  const stream = client.beta.messages.stream(
    {
      model: PRICING_MODEL,
      max_tokens: 32000,
      output_config: {
        format: { type: "json_schema", schema: PRICE_SCHEMA },
      },
      messages: [{ role: "user", content: prompt }],
    },
    { signal },
  );
  const msg = await stream.finalMessage();
  const textBlock = msg.content.find((b) => b.type === "text");
  const text =
    textBlock && "text" in textBlock ? (textBlock.text as string) : null;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { prices: SuggestedPrice[] };
    return parsed.prices ?? [];
  } catch {
    throw new Error(
      "The AI's price list got cut off before it finished. Try again, or price one trade at a time.",
    );
  }
}

// ── Background run (same pattern as scope generation) ──────────────────────

const controllers = new Map<string, AbortController>();

export function abortPricingRun(runId: string): boolean {
  const ac = controllers.get(runId);
  if (!ac) return false;
  ac.abort();
  return true;
}

function bgClient(token: string): SupabaseClient {
  return createSb(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export async function runPricingSuggestion(opts: {
  projectId: string;
  token: string;
  runId: string;
}) {
  const { projectId, token, runId } = opts;
  const sb = bgClient(token);
  const ac = new AbortController();
  controllers.set(runId, ac);
  const update = (patch: Record<string, unknown>) =>
    sb
      .from("scope_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", runId);

  try {
    await update({ stage: "Gathering scope & your cost history…", progress: 10 });

    const { data: project } = await sb
      .from("projects")
      .select("name,address,project_type")
      .eq("id", projectId)
      .single();

    // Only lines that are active and not already confirmed-priced.
    const { data: lineRows } = await sb
      .from("line_items")
      .select(
        "id,division_code,division_name,section_code,description,quantity,unit,evidence,status,price_status",
      )
      .eq("project_id", projectId)
      .neq("status", "excluded");
    const lines = ((lineRows ?? []) as (PriceableLine & { status: string | null })[]).filter(
      (li) => li.price_status !== "confirmed",
    );
    if (!lines.length) {
      await update({
        status: "done",
        stage: "Nothing to price — every line is already confirmed.",
        progress: 100,
      });
      return;
    }

    // Newest first (matters: matching keeps the most recent price on ties).
    // Falls back without section_code if migration 0014 hasn't run.
    let historyRows: unknown[] | null = null;
    const hr1 = await sb
      .from("cost_database")
      .select(
        "division_code,section_code,description,unit,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_note,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (!hr1.error) historyRows = hr1.data;
    else {
      const hr2 = await sb
        .from("cost_database")
        .select(
          "division_code,description,unit,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_note,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      historyRows = hr2.data;
    }

    let clarifications: { question: string; answer: string }[] = [];
    const cla = await sb
      .from("scope_findings")
      .select("text,answer")
      .eq("project_id", projectId)
      .not("answer", "is", null);
    if (!cla.error) {
      clarifications = (cla.data ?? [])
        .filter((r) => ((r as { answer: string | null }).answer ?? "").trim())
        .map((r) => {
          const row = r as { text: string; answer: string };
          return { question: row.text, answer: row.answer.trim() };
        });
    }

    // ── Stage 1: match your own price history (free, deterministic) ────────
    if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    await update({ stage: "Matching your price history…", progress: 20 });

    const history = (historyRows ?? []) as HistoryRow[];
    // Zeros are clutter — store null for unused buckets (display shows empty).
    const z = (n: number | null | undefined) => (n ? n : null);
    const matchedIds = new Set<string>();
    const matchUpdates: { id: string; patch: Record<string, unknown> }[] = [];
    for (const li of lines) {
      const m = findBestMatch(li, history);
      if (!m) continue;
      const h = m.row;
      const months =
        (Date.now() - new Date(h.created_at).getTime()) /
        (30 * 24 * 3600 * 1000);
      const stale = months > 12;
      const when = new Date(h.created_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
      matchUpdates.push({
        id: li.id,
        patch: {
          price_mode: h.price_mode ?? "unit",
          cost_labor: z(h.cost_labor),
          cost_material: z(h.cost_material),
          cost_sub: z(h.cost_sub),
          cost_equipment: z(h.cost_equipment),
          cost_other: z(h.cost_other),
          cost_total: z(h.cost_total),
          price_source: "history",
          price_note: `Matched your history: "${h.description}" (${when})${stale ? " — over a year old, verify" : ""}`,
          price_confidence: stale ? "medium" : "high",
          price_status: "proposed",
          priced_at: new Date().toISOString(),
        },
      });
      matchedIds.add(li.id);
    }
    for (let i = 0; i < matchUpdates.length; i += 10) {
      await Promise.all(
        matchUpdates.slice(i, i + 10).map((u) =>
          sb
            .from("line_items")
            .update(u.patch)
            .eq("id", u.id)
            .neq("price_status", "confirmed"),
        ),
      );
    }

    // ── Stage 2: AI prices whatever your history didn't cover ──────────────
    const aiLines = lines.filter((li) => !matchedIds.has(li.id));
    if (!aiLines.length) {
      await update({
        status: "done",
        stage: `Done — all ${matchedIds.size} lines matched from your price history (no AI needed).`,
        progress: 100,
      });
      return;
    }

    if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    await update({
      stage: `${matchedIds.size} matched from history · pricing ${aiLines.length} lines with AI…`,
      progress: 35,
    });

    const suggestions = await suggestPrices({
      project: project ?? { name: null, address: null, project_type: null },
      clarifications,
      lines: aiLines,
      history: history.slice(0, 60),
      signal: ac.signal,
    });

    if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    await update({ stage: "Saving proposed prices…", progress: 85 });

    const lineIds = new Set(lines.map((l) => l.id));
    const valid = suggestions.filter((s) => lineIds.has(s.id));
    // Write in small batches; never touch confirmed lines (filtered above).
    for (let i = 0; i < valid.length; i += 10) {
      await Promise.all(
        valid.slice(i, i + 10).map((s) =>
          sb
            .from("line_items")
            .update({
              price_mode: s.price_mode,
              cost_labor: z(s.labor),
              cost_material: z(s.material),
              cost_sub: z(s.subcontractor),
              cost_equipment: z(s.equipment),
              cost_other: z(s.other),
              cost_total: null, // AI prices in buckets; clear any stale total

              price_source: s.basis,
              price_note: s.note,
              price_confidence: s.confidence,
              price_status: "proposed",
              priced_at: new Date().toISOString(),
            })
            .eq("id", s.id)
            .neq("price_status", "confirmed"),
        ),
      );
    }

    await update({ status: "done", stage: "Done", progress: 100 });
  } catch (e) {
    const aborted =
      ac.signal.aborted || (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      await update({
        status: "cancelled",
        stage: "Cancelled",
        error: null,
        progress: 100,
      });
    } else {
      await update({
        status: "error",
        error: e instanceof Error ? e.message : "Price suggestion failed.",
        progress: 100,
      });
    }
  } finally {
    controllers.delete(runId);
  }
}
