-- ============================================================================
-- XtraUnit Estimator — Phase 10: Estimate (markups + totals)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- One row per project holding the markup percentages. The totals themselves
-- are always computed live from line_items (never stored stale):
--   direct cost subtotal
--     + contingency %        (on the subtotal)
--     + insurance %          (on the running total)
--     + overhead %           (on the running total)
--     + profit %             (on the running total)
--   = grand total (the bid number)
-- ============================================================================

create table if not exists public.estimates (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null unique references public.projects (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,

  contingency_pct  numeric not null default 0,
  insurance_pct    numeric not null default 0,
  overhead_pct     numeric not null default 0,
  profit_pct       numeric not null default 0,

  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.estimates enable row level security;

drop policy if exists "estimates_select_own" on public.estimates;
create policy "estimates_select_own"
  on public.estimates for select using (auth.uid() = owner_id);
drop policy if exists "estimates_insert_own" on public.estimates;
create policy "estimates_insert_own"
  on public.estimates for insert with check (auth.uid() = owner_id);
drop policy if exists "estimates_update_own" on public.estimates;
create policy "estimates_update_own"
  on public.estimates for update using (auth.uid() = owner_id);
drop policy if exists "estimates_delete_own" on public.estimates;
create policy "estimates_delete_own"
  on public.estimates for delete using (auth.uid() = owner_id);

create index if not exists estimates_project_id_idx on public.estimates (project_id);
