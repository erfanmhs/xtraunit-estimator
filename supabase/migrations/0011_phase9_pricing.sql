-- ============================================================================
-- XtraUnit Estimator — Phase 9: Pricing
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Three parts:
--   1. Pricing fields on line_items — every scope line gets a cost built from
--      quantity × unit cost (or a lump sum), split into five buckets
--      (labor / material / subcontractor / equipment / other), with a source,
--      a confidence, and a status. AI suggestions stay 'proposed' until the
--      user confirms. Direct cost only — markups are Phase 10.
--   2. cost_database — the growing price history. Confirming a price saves it
--      here so future jobs can reuse it ("you paid $2.10/sf on Erwin St").
--   3. scope_runs.kind — lets the same background-job table track pricing
--      suggestion runs alongside scope generation runs.
-- ============================================================================

-- 1) Pricing fields on line_items
alter table public.line_items
  add column if not exists price_mode       text default 'unit',
                            -- 'unit' = the five costs are $/unit, total = quantity × sum
                            -- 'lump' = the five costs are totals in $, total = sum
  add column if not exists cost_labor       numeric,
  add column if not exists cost_material    numeric,
  add column if not exists cost_sub         numeric,   -- subcontractor / trade partner
  add column if not exists cost_equipment   numeric,
  add column if not exists cost_other       numeric,
  add column if not exists price_source     text,      -- 'sub_quote' | 'history' | 'market' | 'manual'
  add column if not exists price_note       text,      -- e.g. 'ABC Plumbing quote 6/8' or 'AI market estimate'
  add column if not exists price_confidence text,      -- 'high' | 'medium' | 'low'
  add column if not exists price_status     text default 'unpriced',
                            -- 'unpriced' | 'proposed' (entered/AI-suggested, not confirmed) | 'confirmed'
  add column if not exists priced_at        timestamptz;

-- 2) The growing cost database
create table if not exists public.cost_database (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,

  division_code   text,
  description     text not null,
  unit            text,
  price_mode      text default 'unit',
  cost_labor      numeric,
  cost_material   numeric,
  cost_sub        numeric,
  cost_equipment  numeric,
  cost_other      numeric,

  price_source    text,
  price_note      text,
  price_confidence text,
  created_at      timestamptz not null default now()
);

alter table public.cost_database enable row level security;

drop policy if exists "cost_database_select_own" on public.cost_database;
create policy "cost_database_select_own"
  on public.cost_database for select using (auth.uid() = owner_id);
drop policy if exists "cost_database_insert_own" on public.cost_database;
create policy "cost_database_insert_own"
  on public.cost_database for insert with check (auth.uid() = owner_id);
drop policy if exists "cost_database_update_own" on public.cost_database;
create policy "cost_database_update_own"
  on public.cost_database for update using (auth.uid() = owner_id);
drop policy if exists "cost_database_delete_own" on public.cost_database;
create policy "cost_database_delete_own"
  on public.cost_database for delete using (auth.uid() = owner_id);

create index if not exists cost_database_owner_id_idx on public.cost_database (owner_id);
create index if not exists cost_database_division_idx on public.cost_database (division_code);

-- 3) Background-run kind (scope generation vs pricing suggestion)
alter table public.scope_runs
  add column if not exists kind text default 'scope';   -- 'scope' | 'pricing'
