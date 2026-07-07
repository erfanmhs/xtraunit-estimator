"use server";

/**
 * Start scope generation in the background, and poll its status.
 * The heavy work runs fire-and-forget in runScopeGeneration so the user can
 * navigate away; progress is read from the scope_runs row.
 */
import { createClient } from "@/lib/supabase/server";
import { runScopeGeneration, abortScopeRun } from "@/lib/scope/run";
import { lineItemPatch, tradesInput } from "@/lib/validation";
import { enforceAiLimit } from "@/lib/ai-usage";

export type ScopeRun = {
  id: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function startScope(
  projectId: string,
  trades: string[] = [],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user || !session) return { ok: false, error: "Not signed in." };

  const validTrades = tradesInput.safeParse(trades);
  if (!validTrades.success)
    return { ok: false, error: "That trade selection wasn't valid." };

  // Don't start a second run if one is GENUINELY still going. A run whose
  // process died leaves a stale "running" row that never updates — we must not
  // let that block new runs forever, or Regenerate silently does nothing.
  // A live run heartbeats every ~1–2 min between chunks; treat >3 min without
  // an update as dead, mark it errored, and proceed. (kind filter skipped if
  // migration 0011 hasn't run — before it there are only scope runs.)
  let existing = await supabase
    .from("scope_runs")
    .select("id,updated_at")
    .eq("project_id", projectId)
    .eq("status", "running")
    .eq("kind", "scope")
    .maybeSingle();
  if (existing.error) {
    existing = await supabase
      .from("scope_runs")
      .select("id,updated_at")
      .eq("project_id", projectId)
      .eq("status", "running")
      .maybeSingle();
  }
  if (existing.data) {
    const age = Date.now() - new Date(existing.data.updated_at).getTime();
    if (age < 3 * 60 * 1000) return { ok: true }; // a live run is in progress
    // Stale row from a dead process — clear it so this Regenerate can proceed.
    await supabase
      .from("scope_runs")
      .update({ status: "error", error: "Interrupted.", updated_at: new Date().toISOString() })
      .eq("id", existing.data.id);
  }

  // Guard the AI bill — refuse if the user is over their daily/monthly cap.
  const limit = await enforceAiLimit(supabase, user.id, "scope");
  if (!limit.ok) return { ok: false, error: limit.error };

  const { data: run, error } = await supabase
    .from("scope_runs")
    .insert({
      project_id: projectId,
      owner_id: user.id,
      status: "running",
      stage: "Starting…",
      progress: 2,
    })
    .select("id")
    .single();
  if (error || !run) return { ok: false, error: "Could not start generation." };

  // Fire-and-forget: continues after this action returns.
  void runScopeGeneration({
    projectId,
    userId: user.id,
    token: session.access_token,
    runId: run.id,
    trades,
  });

  return { ok: true };
}

// ── Editable scope canvas ──────────────────────────────────────────────────
// Every human touch (edit / confirm / exclude) sets user_edited = true so the
// line is protected from being wiped on the next AI regenerate.

type ActionResult = { ok: boolean; error?: string };

export async function updateLineItem(
  lineId: string,
  patch: {
    description?: string;
    quantity?: number | null;
    unit?: string | null;
    notes?: string | null;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = lineItemPatch.safeParse(patch);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That change wasn't valid.",
    };

  const clean: Record<string, unknown> = { user_edited: true };
  if (patch.description !== undefined) {
    if (!patch.description.trim())
      return { ok: false, error: "Description can't be empty." };
    clean.description = patch.description.trim();
  }
  if (patch.quantity !== undefined) clean.quantity = patch.quantity;
  if (patch.unit !== undefined) clean.unit = patch.unit?.trim() || null;
  if (patch.notes !== undefined) clean.notes = patch.notes?.trim() || null;

  const { error } = await supabase
    .from("line_items")
    .update(clean)
    .eq("id", lineId);
  if (error) return { ok: false, error: "Could not save the change." };
  return { ok: true };
}

export async function setLineStatus(
  lineId: string,
  status: "proposed" | "confirmed" | "excluded",
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("line_items")
    .update({ status, user_edited: true })
    .eq("id", lineId);
  if (error) return { ok: false, error: "Could not update the line." };
  return { ok: true };
}

export async function deleteLineItem(lineId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("line_items").delete().eq("id", lineId);
  if (error) return { ok: false, error: "Could not delete the line." };
  return { ok: true };
}

export type NewLineItem = {
  division_code: string | null;
  division_name: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
};

export async function addLineItem(
  projectId: string,
  line: NewLineItem,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!line.description.trim())
    return { ok: false, error: "Description can't be empty." };

  const { data, error } = await supabase
    .from("line_items")
    .insert({
      project_id: projectId,
      owner_id: user.id,
      division_code: line.division_code,
      division_name: line.division_name,
      description: line.description.trim(),
      quantity: line.quantity,
      unit: line.unit?.trim() || null,
      source_kind: "takeoff",
      status: "confirmed",
      confidence: "high",
      ai_generated: false,
      user_edited: true,
      sort_order: 999,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not add the line." };
  return { ok: true, id: data.id };
}

export async function answerFinding(
  findingId: string,
  answer: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = answer.trim();
  const { error } = await supabase
    .from("scope_findings")
    .update({
      answer: trimmed || null,
      answered_at: trimmed ? new Date().toISOString() : null,
      resolved: !!trimmed,
    })
    .eq("id", findingId);
  if (error)
    return {
      ok: false,
      error:
        "Could not save your answer. (Has migration 0010 been run in Supabase?)",
    };
  return { ok: true };
}

export async function setFindingResolved(
  findingId: string,
  resolved: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("scope_findings")
    .update({ resolved })
    .eq("id", findingId);
  if (error) return { ok: false, error: "Could not update the finding." };
  return { ok: true };
}

// Correct a sheet's discipline (drives which sheets each CSI-division draft
// pass reads). Persisted so the fix sticks across regenerates.
export async function setSheetDiscipline(
  sheetId: string,
  discipline: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("sheets")
    .update({ discipline })
    .eq("id", sheetId);
  if (error)
    return {
      ok: false,
      error:
        "Could not save. (Has migration 0026 been run in Supabase?)",
    };
  return { ok: true };
}

export async function cancelScope(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let runRes = await supabase
    .from("scope_runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "running")
    .eq("kind", "scope")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runRes.error) {
    runRes = await supabase
      .from("scope_runs")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  const run = runRes.data;
  if (!run) return { ok: true }; // nothing running

  // Abort the AI stream in-process (immediate) and mark the run cancelled in the
  // DB (covers the case where the process restarted and the controller is gone).
  abortScopeRun(run.id);
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

export async function getScopeRun(projectId: string): Promise<ScopeRun | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let res = await supabase
    .from("scope_runs")
    .select("id,status,stage,progress,error,created_at,updated_at")
    .eq("project_id", projectId)
    .eq("kind", "scope")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    // kind column not there yet (migration 0011 pending) — all runs are scope runs.
    res = await supabase
      .from("scope_runs")
      .select("id,status,stage,progress,error,created_at,updated_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  const data = res.data;
  if (!data) return null;

  const run = data as ScopeRun;
  // If a "running" job hasn't updated in 8 minutes, treat it as failed
  // (the process likely restarted mid-run).
  if (run.status === "running") {
    const age = Date.now() - new Date(run.updated_at).getTime();
    if (age > 8 * 60 * 1000) {
      return {
        ...run,
        status: "error",
        error:
          "The last generation didn't finish (the server may have restarted). Any scope already shown is unchanged — click Regenerate to run it again.",
      };
    }
  }
  return run;
}
