import "server-only";

/**
 * The job queue — enqueue, cancel, and how the UI reads a job's status.
 *
 * A job is a scope_runs row. With migration 0034 + SUPABASE_SERVICE_ROLE_KEY
 * in place, new jobs are inserted as 'queued' and a worker (jobs/worker.ts)
 * picks them up — so they survive restarts and any instance can run them.
 * Without either, enqueueJob() falls back to the old behavior: the row is
 * 'running' and the caller runs the job in-process right away. Either way
 * the Generate button, the progress bar, and Cancel work the same.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasServiceRole } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export type JobKind = "scope" | "pricing" | "apply";

/** Heartbeat cadence and the point at which a silent job counts as orphaned. */
export const HEARTBEAT_MS = 30_000;
export const STALE_SECONDS = 180;

/** True when jobs should go through the durable queue. */
export function queueEnabled(): boolean {
  return hasServiceRole() && process.env.JOB_QUEUE_ENABLED !== "false";
}

export type EnqueueResult =
  | { ok: true; id: string; mode: "queued" | "direct" }
  | { ok: false; error: string };

/**
 * Create the job row. "queued" = a worker will run it; "direct" = the caller
 * must run it in-process now (queue off, or migration 0034 not run yet).
 */
export async function enqueueJob(
  sb: SupabaseClient,
  job: { projectId: string; ownerId: string; kind: JobKind; payload?: Record<string, unknown> },
): Promise<EnqueueResult> {
  const base = {
    project_id: job.projectId,
    owner_id: job.ownerId,
    kind: job.kind,
    progress: 2,
  };

  if (queueEnabled()) {
    const q = await sb
      .from("scope_runs")
      .insert({
        ...base,
        status: "queued",
        stage: "Queued — starting in a moment…",
        payload: job.payload ?? {},
      })
      .select("id")
      .single();
    if (!q.error && q.data) {
      log.info("job.enqueued", { jobId: q.data.id, kind: job.kind, projectId: job.projectId });
      return { ok: true, id: q.data.id, mode: "queued" };
    }
    // Columns missing → migration 0034 not run yet. Fall through to direct.
    log.warn("job.enqueue.fallback", { kind: job.kind, note: "is migration 0034 run?", err: q.error });
  }

  const d = await sb
    .from("scope_runs")
    .insert({ ...base, status: "running", stage: "Starting…" })
    .select("id")
    .single();
  if (!d.error && d.data) return { ok: true, id: d.data.id, mode: "direct" };

  // Older DB without the kind column (pre-0011): only scope runs exist.
  if (job.kind === "scope") {
    const legacy = await sb
      .from("scope_runs")
      .insert({ project_id: job.projectId, owner_id: job.ownerId, status: "running", stage: "Starting…", progress: 2 })
      .select("id")
      .single();
    if (!legacy.error && legacy.data) return { ok: true, id: legacy.data.id, mode: "direct" };
  }
  return { ok: false, error: "Could not start." };
}

/**
 * Ask a running job to stop. The worker sees the flag on its next heartbeat
 * and aborts the AI stream; the in-process abort (same instance) is instant.
 * Best-effort: the column only exists after migration 0034.
 */
export async function requestCancel(sb: SupabaseClient, runId: string): Promise<void> {
  const { error } = await sb.from("scope_runs").update({ cancel_requested: true }).eq("id", runId);
  if (error) log.debug("job.cancel.flag_skipped", { runId, note: "is migration 0034 run?" });
}

/**
 * What the UI should show. A 'queued' job is "running" as far as the progress
 * bar is concerned (it polls until the job leaves 'running').
 */
export function normalizeRun<T extends { status: string; stage: string | null }>(run: T): T {
  if (run.status !== "queued") return run;
  return { ...run, status: "running", stage: run.stage || "Queued — starting in a moment…" };
}

/** Statuses that mean "still in progress" when checking for a live run. */
export const ACTIVE_STATUSES = ["queued", "running"] as const;
