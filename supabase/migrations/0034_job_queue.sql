-- ============================================================================
-- XtraUnit Estimator — Durable job queue for the AI runs
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Until now an AI run (scope draft, apply, pricing) lived only inside the web
-- server's memory: a restart or a deploy mid-run lost it. This turns the
-- existing scope_runs rows into real queue entries:
--
--   status      'queued' → 'running' → 'done' | 'error' | 'cancelled'
--   payload     what the job needs (e.g. the selected trades)
--   attempts    how many times a worker has picked it up (max_attempts = 2)
--   claimed_by  which server instance is working on it, and since when
--   heartbeat_at the worker touches this every 30 s while it works
--   cancel_requested  the Cancel button sets this; the worker aborts on it
--   checkpoint  finished division groups saved as they complete, so a resumed
--               scope run skips what's already been paid for
--
-- Two functions the worker calls (SECURITY DEFINER, service_role only):
--   claim_next_job(worker)        hands ONE queued job to ONE worker, even when
--                                 several web instances poll at once
--                                 (FOR UPDATE SKIP LOCKED)
--   reclaim_orphaned_jobs(secs)   a running job with no heartbeat for `secs`
--                                 (default 180) is put back in the queue, or
--                                 failed with a plain message once it has used
--                                 its attempts
--
-- The app's Cancel / progress polling keep using the same rows, so nothing
-- changes for the person clicking Generate. Without this migration the app
-- keeps its old in-process behavior.
-- ============================================================================

alter table public.scope_runs
  add column if not exists payload          jsonb,
  add column if not exists attempts         integer not null default 0,
  add column if not exists max_attempts     integer not null default 2,
  add column if not exists claimed_by       text,
  add column if not exists claimed_at       timestamptz,
  add column if not exists heartbeat_at     timestamptz,
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists checkpoint       jsonb,
  add column if not exists finished_at      timestamptz;

-- The worker's "what's next" lookup.
create index if not exists scope_runs_queue_idx
  on public.scope_runs (status, created_at)
  where status in ('queued', 'running');

-- Hand exactly one queued job to the calling worker.
create or replace function public.claim_next_job(p_worker text)
returns setof public.scope_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.scope_runs;
begin
  select * into r
    from public.scope_runs
   where status = 'queued'
     and cancel_requested = false
   order by created_at
   limit 1
   for update skip locked;

  if not found then
    return;
  end if;

  update public.scope_runs
     set status       = 'running',
         claimed_by   = p_worker,
         claimed_at   = now(),
         heartbeat_at = now(),
         attempts     = attempts + 1,
         updated_at   = now()
   where id = r.id
   returning * into r;

  return next r;
end;
$$;

revoke all on function public.claim_next_job(text) from public;
grant execute on function public.claim_next_job(text) to service_role;

-- Put orphaned jobs back in the queue (or fail them once out of attempts).
-- Only jobs the queue itself claimed (claimed_at set) are touched — older
-- in-process runs are left to the app's existing staleness handling.
create or replace function public.reclaim_orphaned_jobs(p_stale_seconds integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  failed   integer;
  requeued integer;
begin
  update public.scope_runs
     set status      = 'error',
         error       = 'This run was interrupted twice (server restarts) and has been stopped. Anything already shown is unchanged — please start it again.',
         progress    = 100,
         finished_at = now(),
         updated_at  = now()
   where status = 'running'
     and claimed_at is not null
     and coalesce(heartbeat_at, updated_at) < now() - make_interval(secs => p_stale_seconds)
     and attempts >= max_attempts;
  get diagnostics failed = row_count;

  update public.scope_runs
     set status       = 'queued',
         claimed_by   = null,
         claimed_at   = null,
         heartbeat_at = null,
         stage        = 'Interrupted — restarting shortly…',
         updated_at   = now()
   where status = 'running'
     and claimed_at is not null
     and coalesce(heartbeat_at, updated_at) < now() - make_interval(secs => p_stale_seconds)
     and attempts < max_attempts;
  get diagnostics requeued = row_count;

  return failed + requeued;
end;
$$;

revoke all on function public.reclaim_orphaned_jobs(integer) from public;
grant execute on function public.reclaim_orphaned_jobs(integer) to service_role;
