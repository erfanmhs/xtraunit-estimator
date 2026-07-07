"use server";

/**
 * Phase 9 — Pricing actions.
 * Every price is editable, confirmable, and clearable. Confirming a price also
 * snapshots it into cost_database so the next job can reuse it. AI suggestions
 * run as a background job (same scope_runs table, kind 'pricing').
 */
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runPricingSuggestion, abortPricingRun } from "@/lib/scope/price";
import { readSubQuote, type QuoteExtraction } from "@/lib/scope/subquote";
import { findOrCreateItem, recomputeItemStd } from "@/lib/scope/items";
import { enforceAiLimit } from "@/lib/ai-usage";
import type { ScopeRun } from "../scope/actions";

type ActionResult = { ok: boolean; error?: string };

// A confirmed line, as selected from line_items for snapshotting.
type ConfirmedLine = {
  id: string;
  project_id: string | null;
  division_code: string | null;
  section_code: string | null;
  description: string;
  unit: string | null;
  price_mode: string | null;
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
  price_source: string | null;
  price_note: string | null;
  price_confidence: string | null;
};

const CONFIRMED_LINE_COLS =
  "id,project_id,division_code,section_code,description,unit,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_source,price_note,price_confidence";

// The job context stamped onto every observation so the price stays useful
// (and poolable) forever — region, project type, building size.
type PriceContext = {
  region: string | null;
  project_type: string | null;
  building_sf: number | null;
};

async function loadPriceContext(
  supabase: SupabaseClient,
  projectId: string | null,
): Promise<PriceContext> {
  if (!projectId) return { region: "CA", project_type: null, building_sf: null };
  const { data: project } = await supabase
    .from("projects")
    .select("project_type,region")
    .eq("id", projectId)
    .maybeSingle();
  let buildingSf: number | null = null;
  const est = await supabase
    .from("estimates")
    .select("building_sf")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!est.error) buildingSf = est.data?.building_sf ?? null;
  return {
    // Default to California — XtraUnit's market — when none is set yet.
    region: (project?.region as string | null) || "CA",
    project_type: (project?.project_type as string | null) ?? null,
    building_sf: buildingSf,
  };
}

/**
 * Snapshot confirmed lines into the cost-database spine: link each to its
 * canonical cost item, insert the observation (with context), then refresh
 * the affected items' standard prices. Resilient if migration 0021 (or 0014)
 * hasn't run — it retries with only the legacy columns.
 */
async function snapshotConfirmed(
  supabase: SupabaseClient,
  userId: string,
  lines: ConfirmedLine[],
  ctx: PriceContext,
): Promise<void> {
  const touchedItems = new Set<string>();
  const rows: Record<string, unknown>[] = [];

  for (const li of lines) {
    const itemId = await findOrCreateItem(supabase, userId, {
      division_code: li.division_code,
      section_code: li.section_code,
      description: li.description,
      unit: li.unit,
    });
    if (itemId) touchedItems.add(itemId);
    rows.push({
      owner_id: userId,
      project_id: li.project_id,
      item_id: itemId,
      source: "confirmed",
      region: ctx.region,
      project_type: ctx.project_type,
      building_sf: ctx.building_sf,
      division_code: li.division_code,
      section_code: li.section_code,
      description: li.description,
      unit: li.unit,
      price_mode: li.price_mode ?? "unit",
      cost_labor: li.cost_labor,
      cost_material: li.cost_material,
      cost_sub: li.cost_sub,
      cost_equipment: li.cost_equipment,
      cost_other: li.cost_other,
      cost_total: li.cost_total,
      price_source: li.price_source,
      price_note: li.price_note,
      price_confidence: li.price_confidence,
    });
  }

  const ins = await supabase.from("cost_database").insert(rows);
  if (ins.error) {
    // Fallback for a DB missing the 0021/0014 columns — keep the legacy fields.
    const legacy = rows.map((r) => {
      const {
        item_id: _i, source: _s, region: _r, project_type: _t,
        building_sf: _b, observed_on: _o, section_code: _c, ...rest
      } = r;
      void _i; void _s; void _r; void _t; void _b; void _o; void _c;
      return rest;
    });
    await supabase.from("cost_database").insert(legacy);
    return; // can't recompute items if the catalog isn't there yet
  }

  // Refresh each affected item's standard price (includes the new rows).
  for (const id of touchedItems) await recomputeItemStd(supabase, id);
}

export type PricePatch = {
  price_mode?: string; // 'unit' | 'lump' | 'total'
  cost_labor?: number | null;
  cost_material?: number | null;
  cost_sub?: number | null;
  cost_equipment?: number | null;
  cost_other?: number | null;
  cost_total?: number | null; // one final price, used when price_mode = 'total'
  price_source?: string | null;
  price_note?: string | null;
};

export async function updateLinePrice(
  lineId: string,
  patch: PricePatch,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Any edit makes the price "proposed" again — confirmation is an explicit,
  // separate gesture on the exact numbers being confirmed.
  const { error } = await supabase
    .from("line_items")
    .update({
      ...patch,
      price_status: "proposed",
      priced_at: new Date().toISOString(),
    })
    .eq("id", lineId);
  if (error) return { ok: false, error: "Could not save the price." };
  return { ok: true };
}

export async function confirmLinePrice(lineId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: li, error: fetchErr } = await supabase
    .from("line_items")
    .select(CONFIRMED_LINE_COLS)
    .eq("id", lineId)
    .single();
  if (fetchErr || !li) return { ok: false, error: "Line not found." };

  const { error } = await supabase
    .from("line_items")
    .update({ price_status: "confirmed", priced_at: new Date().toISOString() })
    .eq("id", lineId);
  if (error) return { ok: false, error: "Could not confirm the price." };

  // Snapshot into the cost-database spine (history + canonical item) so the
  // next job can reuse it and the catalog's standard price stays current.
  const ctx = await loadPriceContext(supabase, (li as ConfirmedLine).project_id);
  await snapshotConfirmed(supabase, user.id, [li as ConfirmedLine], ctx);

  return { ok: true };
}

/**
 * Confirm many lines at once (a CSI section's worth, or the whole project).
 * Only lines that are currently 'proposed' are touched; each confirmed price
 * is snapshotted into cost_database, same as a single confirm.
 */
export async function confirmManyPrices(
  lineIds: string[],
): Promise<{ ok: boolean; confirmed?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!lineIds.length) return { ok: true, confirmed: 0 };

  const { data: rows, error: fetchErr } = await supabase
    .from("line_items")
    .select(`${CONFIRMED_LINE_COLS},price_status`)
    .in("id", lineIds)
    .eq("price_status", "proposed");
  if (fetchErr) return { ok: false, error: "Could not load the lines." };
  const toConfirm = (rows ?? []) as (ConfirmedLine & { price_status: string })[];
  if (!toConfirm.length) return { ok: true, confirmed: 0 };

  const { error } = await supabase
    .from("line_items")
    .update({ price_status: "confirmed", priced_at: new Date().toISOString() })
    .in(
      "id",
      toConfirm.map((r) => r.id),
    )
    .eq("price_status", "proposed");
  if (error) return { ok: false, error: "Could not confirm the prices." };

  // All lines on one project share a context — load it once.
  const ctx = await loadPriceContext(supabase, toConfirm[0].project_id);
  await snapshotConfirmed(supabase, user.id, toConfirm, ctx);

  return { ok: true, confirmed: toConfirm.length };
}

export async function clearLinePrice(lineId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("line_items")
    .update({
      price_mode: "unit",
      cost_labor: null,
      cost_material: null,
      cost_sub: null,
      cost_equipment: null,
      cost_other: null,
      cost_total: null,
      price_source: null,
      price_note: null,
      price_confidence: null,
      price_status: "unpriced",
      priced_at: null,
    })
    .eq("id", lineId);
  if (error) return { ok: false, error: "Could not clear the price." };
  return { ok: true };
}

/** Clear EVERY price on the project — the whole form back to unpriced.
 *  Cost Database history (from past confirms) is not touched. */
export async function clearAllPrices(
  projectId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("line_items")
    .update({
      price_mode: "unit",
      cost_labor: null,
      cost_material: null,
      cost_sub: null,
      cost_equipment: null,
      cost_other: null,
      cost_total: null,
      price_source: null,
      price_note: null,
      price_confidence: null,
      price_status: "unpriced",
      priced_at: null,
      sub_quote_id: null,
    })
    .eq("project_id", projectId);
  if (error) return { ok: false, error: "Could not clear the prices." };
  return { ok: true };
}

// ── Sub quotes ──────────────────────────────────────────────────────────────

/** AI-read an uploaded quote document (already in storage). */
export async function readQuoteDoc(
  storagePath: string,
  mime: string,
  fileName: string,
): Promise<{ ok: boolean; extraction?: QuoteExtraction; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: blob, error } = await supabase.storage
    .from("plans")
    .download(storagePath);
  if (error || !blob)
    return { ok: false, error: "Could not load the uploaded file." };
  if (blob.size > 20 * 1024 * 1024)
    return { ok: false, error: "File too large — keep quotes under 20 MB." };

  // Guard the AI bill before the read.
  const limit = await enforceAiLimit(supabase, user.id, "subquote");
  if (!limit.ok) return { ok: false, error: limit.error };

  try {
    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const extraction = await readSubQuote({ base64, mime, fileName });
    return { ok: true, extraction };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not read the quote.",
    };
  }
}

export type ApplyQuoteInput = {
  sub_name: string;
  trade: string | null;
  division_codes: string[];
  quote_date: string | null;
  total: number;
  notes: string | null;
  file_path: string | null;
  file_name: string | null;
  extracted: QuoteExtraction | null;
};

/**
 * Save the quote and spread its total over the covered lines: every active,
 * not-yet-confirmed line in the chosen divisions gets a share (proportional to
 * its current price when priced, evenly otherwise), in the SUBCONTRACTOR
 * bucket, as 'proposed' — confirm on the table like any other price.
 */
export async function applySubQuote(
  projectId: string,
  input: ApplyQuoteInput,
): Promise<{ ok: boolean; covered?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.sub_name.trim()) return { ok: false, error: "Sub name is required." };
  if (!Number.isFinite(input.total) || input.total <= 0)
    return { ok: false, error: "Quote total must be a positive number." };
  if (!input.division_codes.length)
    return { ok: false, error: "Pick at least one division the quote covers." };

  const { data: lines, error: linesErr } = await supabase
    .from("line_items")
    .select(
      "id,quantity,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_status,status,division_code",
    )
    .eq("project_id", projectId)
    .in("division_code", input.division_codes);
  if (linesErr) return { ok: false, error: "Could not load the scope lines." };

  const targets = (lines ?? []).filter(
    (li) => li.status !== "excluded" && li.price_status !== "confirmed",
  );
  if (!targets.length)
    return {
      ok: false,
      error:
        "No coverable lines in those divisions (already confirmed or excluded).",
    };

  const { data: quote, error: qErr } = await supabase
    .from("sub_quotes")
    .insert({
      project_id: projectId,
      owner_id: user.id,
      sub_name: input.sub_name.trim(),
      trade: input.trade,
      division_codes: input.division_codes,
      quote_date: input.quote_date,
      total: input.total,
      notes: input.notes,
      file_path: input.file_path,
      file_name: input.file_name,
      extracted: input.extracted,
    })
    .select("id")
    .single();
  if (qErr || !quote)
    return {
      ok: false,
      error: "Could not save the quote. (Has migration 0015 been run?)",
    };

  // Allocate: proportional to current line totals where priced, even otherwise.
  const totalOf = (li: (typeof targets)[number]): number => {
    const mode = li.price_mode ?? "unit";
    if (mode === "total") return li.cost_total ?? 0;
    const sum =
      (li.cost_labor ?? 0) +
      (li.cost_material ?? 0) +
      (li.cost_sub ?? 0) +
      (li.cost_equipment ?? 0) +
      (li.cost_other ?? 0);
    return mode === "lump" ? sum : (li.quantity ?? 0) * sum;
  };
  const weights = targets.map(totalOf);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const shares = targets.map((_, i) =>
    weightSum > 0
      ? (input.total * weights[i]) / weightSum
      : input.total / targets.length,
  );
  // Round to cents; put any rounding remainder on the last line.
  const rounded = shares.map((s) => Math.round(s * 100) / 100);
  const drift =
    Math.round(
      (input.total - rounded.reduce((a, b) => a + b, 0)) * 100,
    ) / 100;
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 100) / 100;

  const note = `${input.sub_name.trim()} quote${input.quote_date ? ` ${input.quote_date}` : ""}`;
  for (let i = 0; i < targets.length; i += 10) {
    await Promise.all(
      targets.slice(i, i + 10).map((li, j) =>
        supabase
          .from("line_items")
          .update({
            price_mode: "lump",
            cost_labor: null,
            cost_material: null,
            cost_sub: rounded[i + j],
            cost_equipment: null,
            cost_other: null,
            cost_total: null,
            price_source: "sub_quote",
            price_note: note,
            price_confidence: "high",
            price_status: "proposed",
            priced_at: new Date().toISOString(),
            sub_quote_id: quote.id,
          })
          .eq("id", li.id),
      ),
    );
  }

  return { ok: true, covered: targets.length };
}

/** Remove a quote: un-price the lines it still covers, delete row + file. */
export async function removeSubQuote(
  quoteId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: quote } = await supabase
    .from("sub_quotes")
    .select("id,file_path")
    .eq("id", quoteId)
    .maybeSingle();

  await supabase
    .from("line_items")
    .update({
      price_mode: "unit",
      cost_sub: null,
      price_source: null,
      price_note: null,
      price_confidence: null,
      price_status: "unpriced",
      priced_at: null,
      sub_quote_id: null,
    })
    .eq("sub_quote_id", quoteId)
    .eq("price_source", "sub_quote")
    .neq("price_status", "confirmed");

  if (quote?.file_path) {
    await supabase.storage.from("plans").remove([quote.file_path]);
  }
  const { error } = await supabase.from("sub_quotes").delete().eq("id", quoteId);
  if (error) return { ok: false, error: "Could not remove the quote." };
  return { ok: true };
}

// ── AI suggestion background run ───────────────────────────────────────────

export async function startPricing(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user || !session) return { ok: false, error: "Not signed in." };

  // Block only on a GENUINELY live run; a stale row from a dead process
  // (>3 min without an update) must not block new runs forever.
  const { data: existing } = await supabase
    .from("scope_runs")
    .select("id,updated_at")
    .eq("project_id", projectId)
    .eq("status", "running")
    .eq("kind", "pricing")
    .maybeSingle();
  if (existing) {
    const age = Date.now() - new Date(existing.updated_at).getTime();
    if (age < 3 * 60 * 1000) return { ok: true };
    await supabase
      .from("scope_runs")
      .update({ status: "error", error: "Interrupted.", updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  }

  // Guard the AI bill — refuse if the user is over their daily/monthly cap.
  const limit = await enforceAiLimit(supabase, user.id, "pricing");
  if (!limit.ok) return { ok: false, error: limit.error };

  const { data: run, error } = await supabase
    .from("scope_runs")
    .insert({
      project_id: projectId,
      owner_id: user.id,
      status: "running",
      stage: "Starting…",
      progress: 2,
      kind: "pricing",
    })
    .select("id")
    .single();
  if (error || !run)
    return {
      ok: false,
      error:
        "Could not start. (Has migration 0011 been run in Supabase? The Pricing page needs it.)",
    };

  void runPricingSuggestion({
    projectId,
    token: session.access_token,
    runId: run.id,
  });

  return { ok: true };
}

export async function getPricingRun(
  projectId: string,
): Promise<ScopeRun | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("scope_runs")
    .select("id,status,stage,progress,error,created_at,updated_at")
    .eq("project_id", projectId)
    .eq("kind", "pricing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const run = data as ScopeRun;
  if (run.status === "running") {
    const age = Date.now() - new Date(run.updated_at).getTime();
    if (age > 8 * 60 * 1000) {
      return {
        ...run,
        status: "error",
        error: "Pricing timed out or was interrupted. Please try again.",
      };
    }
  }
  return run;
}

export async function cancelPricing(
  projectId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: run } = await supabase
    .from("scope_runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "running")
    .eq("kind", "pricing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return { ok: true };

  abortPricingRun(run.id);
  await supabase
    .from("scope_runs")
    .update({
      status: "cancelled",
      stage: "Cancelled",
      error: null,
      progress: 100,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  return { ok: true };
}
