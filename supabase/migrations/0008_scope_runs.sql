-- ============================================================================
-- XtraUnit Estimator — Background scope generation job tracking
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- One row per scope-generation run; the background job updates stage/progress
-- so the Scope page can poll it and you can navigate away while it works.
-- ============================================================================

create table if not exists public.scope_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'running',   -- 'running' | 'done' | 'error'
  stage       text,                              -- human-readable current step
  progress    int  not null default 0,           -- 0..100
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.scope_runs enable row level security;

drop policy if exists "scope_runs_select_own" on public.scope_runs;
create policy "scope_runs_select_own"
  on public.scope_runs for select using (auth.uid() = owner_id);
drop policy if exists "scope_runs_insert_own" on public.scope_runs;
create policy "scope_runs_insert_own"
  on public.scope_runs for insert with check (auth.uid() = owner_id);
drop policy if exists "scope_runs_update_own" on public.scope_runs;
create policy "scope_runs_update_own"
  on public.scope_runs for update using (auth.uid() = owner_id);
drop policy if exists "scope_runs_delete_own" on public.scope_runs;
create policy "scope_runs_delete_own"
  on public.scope_runs for delete using (auth.uid() = owner_id);

create index if not exists scope_runs_project_id_idx on public.scope_runs (project_id);
