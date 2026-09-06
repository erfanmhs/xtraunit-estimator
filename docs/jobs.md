# Background jobs — the durable queue

The three AI runs (scope draft, apply-findings, price suggestions) are queued
jobs. They survive a server restart or a deploy, and any number of web
instances can share the work. Added 2026-09-06.

## How it works

```
Generate clicked ─► scope_runs row (status 'queued', payload)
                       │
        worker on any instance polls every 3 s
                       │  claim_next_job()  (Postgres: FOR UPDATE SKIP LOCKED)
                       ▼
                  status 'running', claimed_by = that instance
                       │  heartbeat_at touched every 30 s (also checks Cancel)
                       │  scope: each finished division group → checkpoint
                       ▼
                  'done' | 'error' | 'cancelled'
```

- **Worker** (`src/lib/jobs/worker.ts`): starts once per server process from
  `src/instrumentation.ts`. Claims up to `JOB_WORKER_CONCURRENCY` (default 2)
  jobs at a time. Written as `createWorker({ sb, handlers })`, so it can be
  moved into its own process later by a script that calls `startWorker()`.
- **Queue helpers** (`src/lib/jobs/queue.ts`): `enqueueJob` (falls back to the
  old in-process run when the queue is off or migration 0034 isn't run),
  `requestCancel`, `normalizeRun` (a queued job shows as "running" to the
  progress bar).
- **Handlers** are the existing job functions in `lib/scope/run.ts` and
  `lib/scope/price.ts`; they now accept `{ sb, ac, checkpoint }` from the
  worker or `{ token }` from the in-process fallback.

## Orphaned / interrupted jobs

| Situation | What happens |
|---|---|
| Deploy or graceful stop (SIGTERM) | The worker puts its running jobs back to `queued` ("Server restarting — resuming shortly…") and aborts them with an *Interrupted* signal so they are not marked cancelled. The new instance claims them within seconds. |
| Crash / instance killed | No heartbeat for **3 min** → `reclaim_orphaned_jobs()` (called by every worker once a minute) requeues the job. |
| Second interruption | `attempts` reaches `max_attempts` (2) → status `error` with a plain message: "interrupted twice… please start it again." |
| Resume of a scope run | Division groups already drafted are read from `checkpoint` and not re-sent to the AI — only the missing groups are paid for again. |
| Cancel | The button aborts in-process (instant) **and** sets `cancel_requested`; a worker on another instance sees it on its next heartbeat. |

Only rows the queue claimed (`claimed_at` set) are ever reclaimed; older
in-process runs keep the app's existing staleness handling.

## Cost cap and logging

Each job still runs inside `runWithAiBudget` (per-run dollar ceiling,
`ai-meter.ts`) and logs `job.enqueued`, `worker.job.start/end`,
`worker.reclaimed`, `worker.cancel_requested`, `*.run.interrupted` etc. via
`lib/log.ts` — errors reach Sentry when a DSN is set.

## Setup

1. Run migration `0034_job_queue.sql` (see `supabase/PENDING-DB-CHANGES.md`).
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Render → Environment (Supabase → Settings
   → API → service_role). This is what turns the queue on. Never put it in
   anything that reaches the browser.
3. Optional: `JOB_QUEUE_ENABLED=false` to force the old in-process behavior on
   a host; `JOB_WORKER_CONCURRENCY` to change parallel jobs per instance.
4. From then on Render can run more than one instance of the web service.

Without step 1 **or** step 2 the app behaves exactly as before (jobs run
inside the request's process).

## Lifting the worker into its own process (later)

`createWorker()` has no Next.js dependencies; `startWorker()` wires the admin
client and the three handlers. A separate Render background worker would run a
small script that imports and calls `startWorker()` — the job code itself
doesn't change. (The `server-only` imports in the handlers need a bundling
step for that; the loop is ready.)
