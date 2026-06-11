-- ============================================================================
-- XtraUnit Estimator — Phase 3: kept pages (sheets) from triage
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ============================================================================

create table if not exists public.sheets (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  plan_file_id         uuid not null references public.plan_files (id) on delete cascade,
  owner_id             uuid not null references auth.users (id) on delete cascade,
  page_number          int not null,          -- page index in the trimmed file (1..N)
  original_page_number int,                    -- page index in the original upload
  label                text,                   -- Architectural / Structural / MEP / Schedules / Civil / Other
  scale_px_per_unit    numeric,                -- set later in the measurement phase
  scale_unit           text,                   -- e.g. 'ft'
  created_at           timestamptz not null default now()
);

alter table public.sheets enable row level security;

drop policy if exists "sheets_select_own" on public.sheets;
create policy "sheets_select_own"
  on public.sheets for select using (auth.uid() = owner_id);

drop policy if exists "sheets_insert_own" on public.sheets;
create policy "sheets_insert_own"
  on public.sheets for insert with check (auth.uid() = owner_id);

drop policy if exists "sheets_update_own" on public.sheets;
create policy "sheets_update_own"
  on public.sheets for update using (auth.uid() = owner_id);

drop policy if exists "sheets_delete_own" on public.sheets;
create policy "sheets_delete_own"
  on public.sheets for delete using (auth.uid() = owner_id);

create index if not exists sheets_plan_file_id_idx on public.sheets (plan_file_id);
create index if not exists sheets_project_id_idx on public.sheets (project_id);
