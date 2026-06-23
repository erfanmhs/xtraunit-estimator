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
    notes: string | null;
    building_sf: number | null;
    benchmarks?: { label: string; sell_low: number | null; sell_high: number | null }[];
    unit_prices?: { item: string; unit: string; cost: number | null }[];
  };
  clarifications: { question: string; answer: string }[];
  lines: PriceableLine[];
  history: HistoryRow[];
  signal?: AbortSignal;
}): Promise<SuggestedPrice[]> {
  const { project, clarifications, lines, history, signal } = opts;
  const client = getAnthropicClient();

  // XtraUnit's standard direct unit prices — the AI applies these when a line
  // matches, so common items price from real numbers, not market guesses.
  const up = (project.unit_prices ?? []).filter((u) => u.cost != null);
  const unitText = up.length
    ? `XTRAUNIT STANDARD UNIT PRICES (direct cost — USE THESE when a scope line matches the item; they override your market estimate):\n${up
        .map((u) => `    • ${u.item}: $${u.cost} per ${u.unit}`)
        .join("\n")}`
    : "";

  const claText = clarifications.length
    ? `USER CLARIFICATIONS (authoritative):\n${clarifications.map((c) => `  Q: ${c.question}\n  A: ${c.answer}`).join("\n")}`
    : "";

  const sf = project.building_sf;
  // Reality anchor — the single biggest guard against the AI drifting high.
  // Prefer XtraUnit's OWN sell $/SF benchmarks (set in Settings); fall back to a
  // generic band if none are configured. Direct cost is ~75–80% of the all-in
  // bid (markups add the rest), so the direct target is below the sell $/SF.
  const bm = project.benchmarks ?? [];
  let anchor: string;
  if (bm.length) {
    const list = bm
      .map((b) => {
        const lo = b.sell_low,
          hi = b.sell_high;
        const range =
          lo != null && hi != null
            ? `$${lo}–$${hi}/SF`
            : `~$${(lo ?? hi)!}/SF`;
        return `    • ${b.label}: ${range} all-in (sell)`;
      })
      .join("\n");
    const dollarTarget =
      sf && bm.some((b) => b.sell_low != null || b.sell_high != null)
        ? (() => {
            const los = bm.map((b) => b.sell_low ?? b.sell_high!).filter((n) => n != null);
            const his = bm.map((b) => b.sell_high ?? b.sell_low!).filter((n) => n != null);
            const lo = Math.min(...los),
              hi = Math.max(...his);
            return ` For this ${sf.toLocaleString()} SF project, that implies an all-in bid roughly between $${Math.round(sf * lo).toLocaleString()} and $${Math.round(sf * hi).toLocaleString()} depending on type — and your DIRECT costs should sum to about 75–80% of the matching figure.`;
        })()
        : "";
    anchor = `REALITY CHECK (critical) — XtraUnit's actual selling prices per square foot, by project type:\n${list}\nPick the type that matches THIS project ("${project.project_type ?? "unknown"}", ${sf ? `${sf.toLocaleString()} SF` : "SF unknown"}). The FINAL all-in bid (after markups) should land in that type's $/SF range.${dollarTarget} Markups are added AFTER your numbers, so your DIRECT costs (before markups) should sum to roughly 75–80% of the all-in. If your line costs would sum higher than this, you are PRICING TOO HIGH — lower your unit costs to XtraUnit's competitive level. Sanity-check your own total against this before returning.`;
  } else if (sf) {
    anchor = `REALITY CHECK: this building is about ${sf.toLocaleString()} SF. A realistic ALL-IN bid is usually $200–$400/SF (California). Your DIRECT costs should sum to ~75% of that — roughly $${Math.round(sf * 150).toLocaleString()}–$${Math.round(sf * 300).toLocaleString()} total direct. If higher, you're pricing too high — revise down.`;
  } else {
    anchor = `REALITY CHECK: price at competitive California GC levels. If your numbers trend high, they probably are — err lean, not retail.`;
  }
  // Trade/subcontract work isn't a whole building — a $/SF anchor would mislead.
  if ((project.project_type ?? "").toLowerCase().includes("trade")) {
    anchor = `REALITY CHECK: this is single-trade / subcontract work, NOT a whole building — do NOT anchor to a whole-building $/SF figure. Price ONLY the listed scope at a competitive California buy cost for that trade, lean rather than retail.`;
  }

  const notesText = project.notes?.trim()
    ? `PROJECT NOTES from the estimator (authoritative context — factor these into every price): ${project.notes.trim()}`
    : "";

  const prompt = `XtraUnit is a licensed California general contractor (CA #1033830) pricing all trades. Suggest DIRECT COSTS for each scope line below. A senior estimator will review every number — these are proposals, not final prices. ACCURACY MATTERS MORE THAN CAUTION-PADDING: a number that is too high is just as wrong as one that is too low.

Critical rules:
- DIRECT COST ONLY. Never include overhead, profit, contingency, insurance, or bond — markups are applied separately later. Do NOT pad "to be safe."
- PRICE AT A GC'S REAL BUY COST, not retail or homeowner pricing: the actual wage+burden+material a contractor pays, and competitive subcontractor bid prices for the region — not list price, not big-box retail.
- Split each line's cost into five buckets: labor, material, subcontractor, equipment, other. Use 0 for buckets that don't apply.
- Bucket logic: licensed specialty trades a GC typically subcontracts (plumbing, HVAC, electrical, fire suppression, roofing, elevators) → put the sub's full competitive bid in "subcontractor". Trades a GC commonly self-performs (demo, concrete, framing, drywall, finishes, sitework) → split into labor + material (+ equipment where real). If the cost history shows how this user buys a trade, follow the history instead.
- DO NOT DOUBLE-COUNT. Price each line as exactly what its description says and nothing more. If one line is an assembly (e.g. "slab on grade") and another is a component of it (e.g. "rebar"), price each only for its own portion — never charge the same work twice. If two lines clearly overlap, price the smaller one at the incremental cost only.
- price_mode: use "unit" ($/unit rates; line total = quantity × sum of buckets) when the line has a quantity and unit. Use "lump" (totals in $) only when it has no usable quantity. CAREFUL: in "unit" mode the buckets are PER ONE UNIT — a $30,000 line item over 6,000 SF is $5/SF, not $30,000/SF. Getting this wrong inflates a line 1000×.
- basis: "history" when anchored to the user's cost history below, otherwise "market". confidence: "high" only when anchored to history or a very standard item; "medium" for normal market pricing; "low" for rough allowances.
- note: one short line saying where the number comes from (e.g. "GC cost, LA multifamily" or "from your Erwin St drywall price").
- Return one entry per line, using the exact id given. Do not skip lines — if you truly cannot price one, return zeros with confidence "low" and say why in the note.

${anchor}

PROJECT: ${project.name ?? "Unnamed"} — ${project.project_type ?? "type unknown"} at ${project.address ?? "address unknown"}.

${notesText}

${claText}

${unitText}

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
      .select("name,address,project_type,notes")
      .eq("id", projectId)
      .single();

    // Building area (for the $/SF reality anchor). Resilient if 0018 not run.
    let buildingSf: number | null = null;
    const estRes = await sb
      .from("estimates")
      .select("building_sf")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!estRes.error) buildingSf = estRes.data?.building_sf ?? null;

    // XtraUnit's sell $/SF benchmarks + standard unit prices (Settings).
    // Resilient: select("*") works whatever columns exist (pre/post 0019/0020).
    let benchmarks: { label: string; sell_low: number | null; sell_high: number | null }[] = [];
    let unitPrices: { item: string; unit: string; cost: number | null }[] = [];
    const csRes = await sb.from("company_settings").select("*").maybeSingle();
    if (!csRes.error) {
      if (Array.isArray(csRes.data?.benchmarks)) benchmarks = csRes.data.benchmarks;
      if (Array.isArray(csRes.data?.unit_prices)) unitPrices = csRes.data.unit_prices;
    }

    // Prefer the canonical cost-items catalog (manual override, else the value
    // computed from confirmed work) over the legacy hand-typed list — same idea,
    // but self-updating. Resilient: falls back to the JSON list if 0021 hasn't run.
    const itemsRes = await sb
      .from("cost_items")
      .select("name,unit,std_cost_override,std_cost_computed")
      .eq("active", true);
    if (!itemsRes.error && Array.isArray(itemsRes.data)) {
      const fromCatalog = (itemsRes.data as {
        name: string;
        unit: string | null;
        std_cost_override: number | null;
        std_cost_computed: number | null;
      }[])
        .map((it) => ({
          item: it.name,
          unit: it.unit ?? "ea",
          cost: it.std_cost_override ?? it.std_cost_computed,
        }))
        .filter((u) => u.cost != null);
      if (fromCatalog.length) unitPrices = fromCatalog;
    }

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
      project: {
        name: project?.name ?? null,
        address: project?.address ?? null,
        project_type: project?.project_type ?? null,
        notes: project?.notes ?? null,
        building_sf: buildingSf,
        benchmarks,
        unit_prices: unitPrices,
      },
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
