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
    fileIds = await uploadPlanFiles(bundle, ac.signal);

    // Draft in division-sized chunks (two at a time) so no single AI response
    // can grow large enough to get cut off. Each chunk's lines are filtered to
    // its own divisions before merging, so chunks can't duplicate each other.
    const chunks = chunkTrades(trades);
    const lineItems: GeneratedLineItem[] = [];
    const findings: GeneratedFinding[] = [];
    let failedChunks = 0;
    for (let i = 0; i < chunks.length; i += 2) {
      stopIfCancelled();
      const batch = chunks.slice(i, i + 2);
      const codes = batch
        .flat()
        .map((t) => t.split(" ")[0])
        .join(", ");
      await update({
        stage: `Drafting the scope — divisions ${codes} (${Math.min(i + 2, chunks.length)}/${chunks.length})…`,
        progress: 25 + Math.round((i / chunks.length) * 40),
      });
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
      throw new Error(
        "The AI couldn't draft any divisions this time (it may be busy). Please click Generate again.",
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
      // Clear old findings, but KEEP answered questions — those are the user's
      // clarifications and must survive a regenerate. Fall back to clearing all
      // if the answer column isn't there yet (migration 0010 not run).
      const keepAnswered = await sb
        .from("scope_findings")
        .delete()
        .eq("project_id", projectId)
        .is("answer", null);
      if (keepAnswered.error) {
        await sb.from("scope_findings").delete().eq("project_id", projectId);
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
