-- ============================================================================
-- XtraUnit Estimator — Phase 5: scale, notes, and measurements
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ============================================================================

-- Sheet additions: notes (for the AI) + horizontal/vertical scale.
alter table public.sheets add column if not exists notes text;
alter table public.sheets add column if not exists scale_x numeric;       -- pixels per foot, horizontal
alter table public.sheets add column if not exists scale_y numeric;       -- pixels per foot, vertical
alter table public.sheets add column if not exists scale_unit text default 'ft';
alter table public.sheets add column if not exists scale_preset text;     -- e.g. '1/4"=1ft' when preset used

-- Measurements: the takeoff results.
create table if not exists public.measurements (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  plan_file_id uuid not null references public.plan_files (id) on delete cascade,
  sheet_id     uuid not null references public.sheets (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  type         text not null,            -- 'line' | 'polyline' | 'area' | 'wall' | 'count'
  geometry     jsonb not null,           -- array of {x, y} points in image coordinates
  value        numeric,                  -- length (ft), area (sf), or count
  unit         text,                     -- 'ft' | 'sf' | 'ea'
  layer        text,                     -- user's layer/name tag
  color        text,                     -- display color
  attributes   jsonb,                    -- any extra attributes
  wall_sided   text,                     -- 'single' | 'double' (wall only)
  wall_height  numeric,                  -- feet (wall only)
  created_at   timestamptz not null default now()
);

alter table public.measurements enable row level security;

drop policy if exists "measurements_select_own" on public.measurements;
create policy "measurements_select_own"
  on public.measurements for select using (auth.uid() = owner_id);

drop policy if exists "measurements_insert_own" on public.measurements;
create policy "measurements_insert_own"
  on public.measurements for insert with check (auth.uid() = owner_id);

drop policy if exists "measurements_update_own" on public.measurements;
create policy "measurements_update_own"
  on public.measurements for update using (auth.uid() = owner_id);

drop policy if exists "measurements_delete_own" on public.measurements;
create policy "measurements_delete_own"
  on public.measurements for delete using (auth.uid() = owner_id);

create index if not exists measurements_sheet_id_idx on public.measurements (sheet_id);
create index if not exists measurements_project_id_idx on public.measurements (project_id);
