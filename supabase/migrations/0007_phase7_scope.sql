-- ============================================================================
-- XtraUnit Estimator — Phase 7: AI scope of work
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Two tables:
--   line_items     — the scope, one row per CSI line (the spine for pricing &
--                    the proposal in later phases).
--   scope_findings — the AI's "what's missing / unclear" gaps, assumptions,
--                    exclusions, and open questions (the second-opinion output).
-- ============================================================================

create table if not exists public.line_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  plan_file_id  uuid references public.plan_files (id) on delete cascade,
  owner_id      uuid not null references auth.users (id) on delete cascade,

  -- CSI MasterFormat classification
  division_code text,                 -- e.g. '08'
  division_name text,                 -- e.g. 'Openings'
  section_code  text,                 -- e.g. '08 11 00' (optional, finer)
  section_name  text,

  description   text not null,        -- the scope line itself

  -- Quantity. May come from the human takeoff OR be measured/estimated by the AI.
  -- Any AI-provided quantity stays status 'proposed' until a user approves it.
  -- null = no quantity yet (AI flagged "needs quantity").
  quantity      numeric,
  unit          text,                 -- ft | sf | cf | cy | ea | ls ...

  -- Grounding / evidence (so every line is traceable).
  -- The core mechanic: the user measures a few DRIVERS (slab SF, ext-wall LF,
  -- bathroom count…); the AI "blooms" each into many scope lines by reading the
  -- whole plan set. A derived line must show its work in `evidence`.
  source_kind   text,                 -- 'takeoff'(human) | 'ai_measured'(AI off the drawing)
                                       -- | 'derived'(computed from a measurement) | 'schedule' | 'note'
                                       -- | 'drawing' | 'assumption'
  evidence      jsonb,                -- e.g. { based_on:[measurement_id], formula:'2400 sf × 4in ÷ 27',
                                       --        assumptions:['4in slab from S-1'], sheet_ids:[], text:'Slab on grade' }

  -- Review state
  status        text default 'proposed',  -- 'proposed' | 'confirmed' | 'needs_quantity' | 'assumption' | 'excluded'
  confidence    text,                 -- 'high' | 'medium' | 'low'

  -- Provenance
  ai_generated  boolean default true,
  user_edited   boolean default false,

  notes         text,
  sort_order    integer default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.scope_findings (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  plan_file_id  uuid references public.plan_files (id) on delete cascade,
  owner_id      uuid not null references auth.users (id) on delete cascade,

  kind          text not null,        -- 'gap' | 'assumption' | 'exclusion' | 'question'
  text          text not null,        -- the finding, in plain language
  severity      text,                 -- 'high' | 'medium' | 'low'
  evidence      jsonb,                -- { sheet_ids:[], text:'...' }
  resolved      boolean default false,
  created_at    timestamptz not null default now()
);

-- Row-level security: owner-only, same pattern as every other table.
alter table public.line_items enable row level security;
alter table public.scope_findings enable row level security;

drop policy if exists "line_items_select_own" on public.line_items;
create policy "line_items_select_own"
  on public.line_items for select using (auth.uid() = owner_id);
drop policy if exists "line_items_insert_own" on public.line_items;
create policy "line_items_insert_own"
  on public.line_items for insert with check (auth.uid() = owner_id);
drop policy if exists "line_items_update_own" on public.line_items;
create policy "line_items_update_own"
  on public.line_items for update using (auth.uid() = owner_id);
drop policy if exists "line_items_delete_own" on public.line_items;
create policy "line_items_delete_own"
  on public.line_items for delete using (auth.uid() = owner_id);

drop policy if exists "scope_findings_select_own" on public.scope_findings;
create policy "scope_findings_select_own"
  on public.scope_findings for select using (auth.uid() = owner_id);
drop policy if exists "scope_findings_insert_own" on public.scope_findings;
create policy "scope_findings_insert_own"
  on public.scope_findings for insert with check (auth.uid() = owner_id);
drop policy if exists "scope_findings_update_own" on public.scope_findings;
create policy "scope_findings_update_own"
  on public.scope_findings for update using (auth.uid() = owner_id);
drop policy if exists "scope_findings_delete_own" on public.scope_findings;
create policy "scope_findings_delete_own"
  on public.scope_findings for delete using (auth.uid() = owner_id);

create index if not exists line_items_project_id_idx on public.line_items (project_id);
create index if not exists line_items_plan_file_id_idx on public.line_items (plan_file_id);
create index if not exists scope_findings_project_id_idx on public.scope_findings (project_id);
