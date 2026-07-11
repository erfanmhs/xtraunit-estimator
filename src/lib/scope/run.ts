import "server-only";

/**
 * Background scope generation. Runs AFTER the request returns (fire-and-forget),
 * so it can't rely on request cookies — it authenticates with the user's access
 * token instead, and reports progress by updating the scope_runs row.
 */
import { createClient as createSb } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatherBundle } from "./bundle";
import {
  draftScope,
  findGaps,
  uploadPlanFiles,
  deletePlanFiles,
  chunkTrades,
  type GeneratedLineItem,
  type GeneratedFinding,
} from "./generate";
import {
  applyFindingsToScope,
  type CurrentLine,
  type FindingResponse,
} from "./applyFindings";

// In-process registry of running jobs so a later request (the Cancel button)
// can abort the AI stream immediately. Works because Next.js server actions and
// this fire-and-forget job run in the same Node process. If the process
// restarted, the controller is simply absent and we fall back to the DB flag.
const controllers = new Map<string, AbortController>();

/** Abort a running job's AI stream by run id. Returns true if one was found. */
export function abortScopeRun(runId: string): boolean {
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

export async function runScopeGeneration(opts: {
  projectId: string;
  userId: string;
  token: string;
  runId: string;
  trades?: string[];
}) {
  const { projectId, userId, token, runId, trades = [] } = opts;
  const sb = bgClient(token);
  const ac = new AbortController();
  controllers.set(runId, ac);
  const stopIfCancelled = () => {
    if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  const update = (patch: Record<string, unknown>) =>
    sb
      .from("scope_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", runId);

  let fileIds: string[] = [];
  try {
    await update({ stage: "Reading your plans…", progress: 10 });
    const bundle = await gatherBundle(sb, projectId);
    stopIfCancelled();
    fileIds = await uploadPlanFiles(sb, bundle, ac.signal);

    // Draft in division-sized chunks (two at a time) so no single AI response
    // can grow large enough to get cut off. Each chunk's lines are filtered to
    // its own divisions before merging, so chunks can't duplicate each other.
    const chunks = chunkTrades(trades);
    const lineItems: GeneratedLineItem[] = [];
    const findings: GeneratedFinding[] = [];
    let failedChunks = 0;
    let firstError: string | null = null;
    // Run the first chunk alone to WARM the prompt cache (writes the plan +
    // rules), then the rest in pairs so they READ the cache instead of
    // re-sending the drawings — much cheaper and faster.
    const batches: string[][][] = [];
    if (chunks.length) batches.push([chunks[0]]);
    for (let i = 1; i < chunks.length; i += 2) batches.push(chunks.slice(i, i + 2));
    let processed = 0;
    for (const batch of batches) {
      stopIfCancelled();
      const codes = batch
        .flat()
        .map((t) => t.split(" ")[0])
        .join(", ");
      await update({
        stage: `Drafting the scope — divisions ${codes} (${processed}/${chunks.length})…`,
        progress: 25 + Math.round((processed / chunks.length) * 40),
      });
      processed += batch.length;
      // Per-chunk fault tolerance: one chunk's transient error must NOT sink the
      // whole run. Keep what succeeds; count failures. (A user cancel still
      // aborts everything — re-thrown below.)
      const parts = await Promise.allSettled(
        batch.map((chunk) => draftScope(bundle, fileIds, chunk, ac.signal)),
      );
      for (let j = 0; j < parts.length; j++) {
        const p = parts[j];
        if (p.status === "rejected") {
          const err = p.reason;
          if (ac.signal.aborted || (err instanceof Error && err.name === "AbortError"))
            throw new DOMException("Cancelled", "AbortError");
          failedChunks++;
          if (!firstError) firstError = err instanceof Error ? err.message : String(err);
          continue;
        }
        const allowed = new Set(
          batch[j].map((t) => t.split(" ")[0].padStart(2, "0")),
        );
        lineItems.push(
          ...p.value.lineItems.filter((li) =>
            allowed.has((li.division_code ?? "").padStart(2, "0")),
          ),
        );
        findings.push(...p.value.findings);
      }
    }
    // Only a total wipeout is a real failure; partial scope is still useful.
    if (!lineItems.length) {
      const detail = firstError ? ` — ${firstError}` : "";
      throw new Error(
        `The AI couldn't draft any divisions this time (${failedChunks}/${chunks.length} parts failed${detail}). Please click Generate again; if it keeps failing, send me this exact message.`,
      );
    }

    stopIfCancelled();
    await update({ stage: "Reviewing for gaps & assumptions…", progress: 70 });
    const gapFindings = await findGaps(
      bundle,
      lineItems,
      fileIds,
      trades,
      ac.signal,
    );

    stopIfCancelled();
    await update({ stage: "Saving the scope…", progress: 90 });

    // Replace prior AI rows (keep user-edited). For a trade-specific run, only
    // clear those trades — leave other trades' scope and findings intact.
    let del = sb
      .from("line_items")
      .delete()
      .eq("project_id", projectId)
      .eq("ai_generated", true)
      .eq("user_edited", false);
    if (trades.length) {
      del = del.in(
        "division_code",
        trades.map((t) => t.split(" ")[0]),
      );
    }
    await del;
    if (!trades.length) {
      // Clear old findings, but KEEP any the user acted on — a saved note/answer,
      // or an explicit Accept/Dismiss — so a regenerate never wipes decisions.
      // Degrade gracefully if migration 0029 (status) / 0010 (answer) isn't run.
      const keepDecided = await sb
        .from("scope_findings")
        .delete()
        .eq("project_id", projectId)
        .is("answer", null)
        .or("status.is.null,status.eq.open");
      if (keepDecided.error) {
        const keepAnswered = await sb
          .from("scope_findings")
          .delete()
          .eq("project_id", projectId)
          .is("answer", null);
        if (keepAnswered.error) {
          await sb.from("scope_findings").delete().eq("project_id", projectId);
        }
      }
    }

    if (lineItems.length) {
      await sb.from("line_items").insert(
        lineItems.map((li, i) => ({
          project_id: projectId,
          owner_id: userId,
          division_code: li.division_code,
          division_name: li.division_name,
          section_code: li.section_code,
          section_name: li.section_name,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          source_kind: li.source_kind,
          evidence: {
            text: li.evidence_text,
            based_on_layers: li.based_on_layers,
            formula: li.formula,
            assumptions: li.assumptions,
          },
          status: "proposed",
          confidence: li.confidence,
          ai_generated: true,
          sort_order: i,
        })),
      );
    }
    const allFindings = [...findings, ...gapFindings];
    if (allFindings.length) {
      const ins = await sb.from("scope_findings").insert(
        allFindings.map((f) => ({
          project_id: projectId,
          owner_id: userId,
          kind: f.kind,
          text: f.text,
          severity: f.severity,
          options: f.options ?? [],
        })),
      );
      if (ins.error) {
        // migration 0031 (options) not run — insert without it.
        await sb.from("scope_findings").insert(
          allFindings.map((f) => ({
            project_id: projectId,
            owner_id: userId,
            kind: f.kind,
            text: f.text,
            severity: f.severity,
          })),
        );
      }
    }

    await update({
      status: "done",
      stage:
        failedChunks > 0
          ? `Done — but ${failedChunks} division group${failedChunks > 1 ? "s" : ""} didn't generate. Click Regenerate to fill them in.`
          : "Done",
      progress: 100,
    });
  } catch (e) {
    const aborted =
      ac.signal.aborted ||
      (e instanceof Error && e.name === "AbortError");
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
        error: e instanceof Error ? e.message : "Scope generation failed.",
        progress: 100,
      });
    }
  } finally {
    controllers.delete(runId);
    // Tidy up the uploaded PDFs (storage is free; just keeping it clean).
    if (fileIds.length) await deletePlanFiles(fileIds);
  }
}

/**
 * Apply the user's finding responses to the existing scope — the cheap path that
 * avoids a full regenerate (no plans re-read, no division chunks). One focused
 * AI call turns the current scope + decisions into targeted edits.
 */
export async function runApplyFindings(opts: {
  projectId: string;
  userId: string;
  token: string;
  runId: string;
}) {
  const { projectId, userId, token, runId } = opts;
  const sb = bgClient(token);
  const ac = new AbortController();
  controllers.set(runId, ac);
  const update = (patch: Record<string, unknown>) =>
    sb
      .from("scope_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", runId);

  try {
    await update({ stage: "Reading your responses…", progress: 20 });

    const { data: lineRows } = await sb
      .from("line_items")
      .select(
        "id,division_code,division_name,section_code,section_name,description,quantity,unit,status,sort_order",
      )
      .eq("project_id", projectId)
      .order("division_code", { ascending: true })
      .order("sort_order", { ascending: true });
    const lines = (lineRows ?? []) as unknown as CurrentLine[];

    // Findings the user responded to but hasn't applied yet (resolved = applied).
    // Resilient to migration 0029 (status) not being run.
    type FRow = {
      id: string;
      kind: string;
      text: string;
      answer: string | null;
      status?: string | null;
      resolved: boolean | null;
    };
    let fRows: FRow[] = [];
    const fTop = await sb
      .from("scope_findings")
      .select("id,kind,text,answer,status,resolved")
      .eq("project_id", projectId);
    if (!fTop.error) fRows = (fTop.data ?? []) as unknown as FRow[];
    else {
      const fMid = await sb
        .from("scope_findings")
        .select("id,kind,text,answer,resolved")
        .eq("project_id", projectId);
      fRows = (fMid.data ?? []) as unknown as FRow[];
    }
    const pending = fRows.filter(
      (f) =>
        !f.resolved &&
        ((f.kind === "question" && (f.answer ?? "").trim()) ||
          f.status === "accepted"),
    );

    if (!pending.length) {
      await update({
        status: "done",
        stage: "Nothing new to apply.",
        progress: 100,
      });
      return;
    }

    const findings: FindingResponse[] = pending.map((f) => ({
      kind: f.kind,
      text: f.text,
      note: f.answer ?? "",
    }));

    // Cheap cached plan text (no vision, no chunking). Resilient if 0009 unrun.
    let planText = "";
    const shRes = await sb
      .from("sheets")
      .select("name,label,page_number,extracted_text")
      .eq("project_id", projectId)
      .order("page_number", { ascending: true });
    if (!shRes.error) {
      planText = (
        (shRes.data ?? []) as unknown as {
          name: string | null;
          label: string | null;
          page_number: number;
          extracted_text: string | null;
        }[]
      )
        .filter((s) => (s.extracted_text ?? "").trim())
        .map((s) => {
          const title = `${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""}`;
          return `=== ${title} ===\n${(s.extracted_text ?? "").trim()}`;
        })
        .join("\n\n");
    }

    await update({ stage: "Updating the scope…", progress: 55 });
    const changes = await applyFindingsToScope({
      lines,
      findings,
      planText,
      signal: ac.signal,
    });
    if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");

    await update({ stage: "Saving the changes…", progress: 85 });
    const validIds = new Set(lines.map((l) => l.id));

    if (changes.additions.length) {
      await sb.from("line_items").insert(
        changes.additions.map((li, i) => ({
          project_id: projectId,
          owner_id: userId,
          division_code: li.division_code,
          division_name: li.division_name,
          section_code: li.section_code,
          section_name: li.section_name,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          source_kind: "note",
          evidence: {
            text: null,
            based_on_layers: [],
            formula: li.formula,
            assumptions: li.assumptions,
          },
          status: "proposed",
          confidence: "medium",
          ai_generated: true,
          user_edited: false,
          sort_order: 900 + i,
        })),
      );
    }

    for (const u of changes.updates) {
      if (!validIds.has(u.id)) continue;
      const patch: Record<string, unknown> = { user_edited: true };
      if (u.description != null) patch.description = u.description;
      if (u.quantity != null) patch.quantity = u.quantity;
      if (u.unit != null) patch.unit = u.unit;
      await sb.from("line_items").update(patch).eq("id", u.id);
    }

    for (const id of changes.exclusions) {
      if (!validIds.has(id)) continue;
      await sb
        .from("line_items")
        .update({ status: "excluded", user_edited: true })
        .eq("id", id);
    }

    // Mark these findings applied so a second click doesn't redo them.
    await sb
      .from("scope_findings")
      .update({ resolved: true })
      .in(
        "id",
        pending.map((f) => f.id),
      );

    const n =
      changes.additions.length +
      changes.updates.filter((u) => validIds.has(u.id)).length +
      changes.exclusions.filter((id) => validIds.has(id)).length;
    await update({
      status: "done",
      stage: n
        ? `Applied — ${n} change${n > 1 ? "s" : ""} to the scope.`
        : "No scope changes were needed.",
      progress: 100,
    });
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
        error:
          e instanceof Error ? e.message : "Could not apply your responses.",
        progress: 100,
      });
    }
  } finally {
    controllers.delete(runId);
  }
}
