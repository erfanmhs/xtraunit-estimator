import "server-only";

/**
 * The job worker — claims queued AI runs and executes them.
 *
 * Runs INSIDE the web server (started once from src/instrumentation.ts), so
 * there's no extra service to pay for or deploy. Scaling still works: every
 * instance runs a worker, and claim_next_job() in Postgres hands each job to
 * exactly one of them. Written as a self-contained `createWorker()` so it can
 * be lifted into its own process later (a script that calls startWorker()).
 *
 * Lifecycle of a job here:
 *   claim (RPC) → run the handler for its kind → heartbeat every 30 s while
 *   it runs (also checks the Cancel flag) → the handler writes done / error /
 *   cancelled itself. Every 60 s the worker also asks Postgres to requeue
 *   orphaned jobs (no heartbeat for 3 min) — that's how a run survives a
 *   crash or a deploy on another instance.
 *
 * On SIGTERM (a deploy) the worker stops claiming, puts its own running jobs
 * straight back in the queue ("resuming shortly"), and aborts them with an
 * InterruptedError so the handlers don't mark them cancelled. The next
 * instance picks them up within seconds and resumes from the checkpoint.
 */
import { hostname } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { HEARTBEAT_MS, STALE_SECONDS, type JobKind } from "./queue";

export type JobRow = {
  id: string;
  kind: JobKind | null;
  project_id: string;
  owner_id: string;
  payload: Record<string, unknown> | null;
  checkpoint: unknown;
  attempts: number;
  max_attempts: number;
};

/** What a handler receives. `sb` is the admin client; `ac` aborts on Cancel. */
export type JobContext = {
  sb: SupabaseClient;
  ac: AbortController;
  job: JobRow;
};
export type JobHandler = (ctx: JobContext) => Promise<void>;

/** The abort reason used for "server restarting" (vs a user's Cancel). */
export function interruptedReason(): DOMException {
  return new DOMException("Interrupted", "InterruptedError");
}
export function wasInterrupted(ac: AbortController): boolean {
  const r = ac.signal.reason as { name?: string } | undefined;
  return ac.signal.aborted && r?.name === "InterruptedError";
}

export type Worker = {
  id: string;
  start(): void;
  stop(): Promise<void>;
  /** For tests / status: jobs currently running on this instance. */
  activeCount(): number;
};

export function createWorker(opts: {
  sb: SupabaseClient;
  handlers: Partial<Record<JobKind, JobHandler>>;
  workerId?: string;
  concurrency?: number;
  pollMs?: number;
  reclaimEveryMs?: number;
  heartbeatMs?: number;
}): Worker {
  const {
    sb,
    handlers,
    workerId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`,
    concurrency = Number(process.env.JOB_WORKER_CONCURRENCY ?? 2),
    pollMs = 3000,
    reclaimEveryMs = 60_000,
    heartbeatMs = HEARTBEAT_MS,
  } = opts;

  const active = new Map<string, { ac: AbortController; job: JobRow }>();
  let running = false;
  let lastReclaim = 0;
  let loopPromise: Promise<void> | null = null;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function reclaim(): Promise<void> {
    const { data, error } = await sb.rpc("reclaim_orphaned_jobs", { p_stale_seconds: STALE_SECONDS });
    if (error) {
      log.warn("worker.reclaim.failed", { workerId, err: error });
      return;
    }
    if (typeof data === "number" && data > 0) log.warn("worker.reclaimed", { workerId, count: data });
  }

  async function claim(): Promise<JobRow | null> {
    const { data, error } = await sb.rpc("claim_next_job", { p_worker: workerId });
    if (error) {
      log.warn("worker.claim.failed", { workerId, err: error });
      return null;
    }
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as JobRow[];
    return rows[0] ?? null;
  }

  async function heartbeat(job: JobRow, ac: AbortController): Promise<void> {
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from("scope_runs")
      .update({ heartbeat_at: now, updated_at: now })
      .eq("id", job.id)
      .eq("status", "running")
      .select("cancel_requested")
      .maybeSingle();
    if (error) {
      log.warn("worker.heartbeat.failed", { workerId, jobId: job.id, err: error });
      return;
    }
    // Row no longer 'running' (cancelled from the UI, or reclaimed by another
    // instance because we looked dead) → stop working on it.
    if (!data) {
      if (!ac.signal.aborted) ac.abort(new DOMException("Cancelled", "AbortError"));
      return;
    }
    if (data.cancel_requested && !ac.signal.aborted) {
      log.info("worker.cancel_requested", { workerId, jobId: job.id });
      ac.abort(new DOMException("Cancelled", "AbortError"));
    }
  }

  async function runJob(job: JobRow): Promise<void> {
    const handler = job.kind ? handlers[job.kind] : undefined;
    const ac = new AbortController();
    active.set(job.id, { ac, job });
    const hb = setInterval(() => void heartbeat(job, ac), heartbeatMs);
    const started = Date.now();
    log.info("worker.job.start", {
      workerId,
      jobId: job.id,
      kind: job.kind,
      projectId: job.project_id,
      attempt: job.attempts,
      resumed: !!job.checkpoint,
    });
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}".`);
      await handler({ sb, ac, job });
      log.info("worker.job.end", { workerId, jobId: job.id, kind: job.kind, ms: Date.now() - started });
    } catch (e) {
      // Handlers write their own status; this is the safety net for a handler
      // that throws before it could.
      log.error("worker.job.crashed", { workerId, jobId: job.id, kind: job.kind, err: e });
      await sb
        .from("scope_runs")
        .update({
          status: "error",
          error: e instanceof Error ? e.message : "The job failed.",
          progress: 100,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "running");
    } finally {
      clearInterval(hb);
      active.delete(job.id);
    }
  }

  async function loop(): Promise<void> {
    log.info("worker.started", { workerId, concurrency, pollMs });
    while (running) {
      try {
        if (Date.now() - lastReclaim > reclaimEveryMs) {
          lastReclaim = Date.now();
          await reclaim();
        }
        while (running && active.size < concurrency) {
          const job = await claim();
          if (!job) break;
          void runJob(job);
        }
      } catch (e) {
        log.error("worker.loop.error", { workerId, err: e });
      }
      await sleep(pollMs);
    }
  }

  return {
    id: workerId,
    start() {
      if (running) return;
      running = true;
      lastReclaim = 0;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      // Hand our running jobs back to the queue so the next instance resumes
      // them, THEN abort with "interrupted" so the handlers don't mark them
      // cancelled or failed.
      for (const [id, { ac, job }] of active) {
        const canRetry = job.attempts < job.max_attempts;
        const now = new Date().toISOString();
        await sb
          .from("scope_runs")
          .update(
            canRetry
              ? { status: "queued", claimed_by: null, claimed_at: null, heartbeat_at: null, stage: "Server restarting — resuming shortly…", updated_at: now }
              : { status: "error", error: "The server restarted during this run and it had no attempts left. Please start it again.", progress: 100, finished_at: now, updated_at: now },
          )
          .eq("id", id)
          .eq("status", "running");
        if (!ac.signal.aborted) ac.abort(interruptedReason());
      }
      log.info("worker.stopped", { workerId, handedBack: active.size });
      await loopPromise?.catch(() => {});
    },
    activeCount: () => active.size,
  };
}

// ── The app's singleton worker (started from instrumentation.ts) ────────────

type Global = typeof globalThis & { __xuJobWorker?: Worker };

/**
 * Start the in-process worker once per server process. No-op without the
 * service-role key (the queue is off then) or when JOB_QUEUE_ENABLED=false.
 */
export async function startWorker(): Promise<Worker | null> {
  const g = globalThis as Global;
  if (g.__xuJobWorker) return g.__xuJobWorker;

  const { queueEnabled } = await import("./queue");
  if (!queueEnabled()) {
    log.info("worker.disabled", { note: "SUPABASE_SERVICE_ROLE_KEY not set or JOB_QUEUE_ENABLED=false — jobs run in-process" });
    return null;
  }

  const [{ adminClient }, { runScopeGeneration, runApplyFindings }, { runPricingSuggestion }] =
    await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/scope/run"),
      import("@/lib/scope/price"),
    ]);

  const worker = createWorker({
    sb: adminClient(),
    handlers: {
      scope: ({ sb, ac, job }) =>
        runScopeGeneration({
          projectId: job.project_id,
          userId: job.owner_id,
          runId: job.id,
          trades: Array.isArray(job.payload?.trades) ? (job.payload!.trades as string[]) : [],
          sb,
          ac,
          checkpoint: job.checkpoint,
          attempt: job.attempts,
        }),
      apply: ({ sb, ac, job }) =>
        runApplyFindings({ projectId: job.project_id, userId: job.owner_id, runId: job.id, sb, ac }),
      pricing: ({ sb, ac, job }) =>
        runPricingSuggestion({ projectId: job.project_id, runId: job.id, sb, ac }),
    },
  });
  g.__xuJobWorker = worker;
  worker.start();

  // Deploys send SIGTERM: hand running jobs back to the queue before exit.
  const onTerm = () => {
    void worker.stop().finally(() => process.exit(0));
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onTerm);
  return worker;
}
