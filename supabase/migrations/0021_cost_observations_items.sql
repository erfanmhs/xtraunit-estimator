-- ============================================================================
-- XtraUnit Estimator — Cost Database spine: price observations + cost items
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- This turns the flat price history into the foundation of the "intelligent
-- RSMeans" data asset, in two connected pieces:
--
--   1. PRICE OBSERVATIONS — the cost_database table grows up. Every confirmed
--      price already lands here; now each one also carries the CONTEXT that
--      makes it useful forever and poolable later: where (region), what kind of
--      job (project_type, building_sf), when the price was real (observed_on),
--      where it came from (source), and which canonical item it belongs to.
--
--   2. COST ITEMS — a new canonical catalog. The distinct things you buy
--      ("Interior door, install"), each pointing at all its observations. Each
--      item has ONE current standard price = your manual override if set, else
--      a value computed from your own observations. This replaces the old
--      hand-typed unit-price list and stops the catalog and history from
--      drifting apart — the catalog IS the history, summarized.
--
-- Nothing is deleted. Existing cost_database rows keep working as-is; the new
-- columns are nullable and fill in going forward (or via "Rebuild catalog").
-- ============================================================================

-- 1) COST ITEMS — the canonical catalog ------------------------------------
create table if not exists public.cost_items (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,

  division_code     text,
  section_code      text,
  name              text not null,         -- canonical, human-readable
  norm_key          text,                  -- normalized tokens, for matching
  unit              text,
  aliases           jsonb not null default '[]'::jsonb,  -- other wordings seen

  std_cost_override numeric,               -- manual "force this number" (per unit, direct)
  std_cost_computed numeric,               -- median per-unit direct cost from observations
  std_count         integer not null default 0,          -- observations behind the computed value
  last_observed     timestamptz,

  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.cost_items enable row level security;

drop policy if exists "cost_items_select_own" on public.cost_items;
create policy "cost_items_select_own"
  on public.cost_items for select using (auth.uid() = owner_id);
drop policy if exists "cost_items_insert_own" on public.cost_items;
create policy "cost_items_insert_own"
  on public.cost_items for insert with check (auth.uid() = owner_id);
drop policy if exists "cost_items_update_own" on public.cost_items;
create policy "cost_items_update_own"
  on public.cost_items for update using (auth.uid() = owner_id);
drop policy if exists "cost_items_delete_own" on public.cost_items;
create policy "cost_items_delete_own"
  on public.cost_items for delete using (auth.uid() = owner_id);

create index if not exists cost_items_owner_idx on public.cost_items (owner_id);
create index if not exists cost_items_division_idx on public.cost_items (division_code);
create index if not exists cost_items_normkey_idx on public.cost_items (owner_id, norm_key);

-- Keep updated_at fresh (re-uses the project trigger function from 0001).
drop trigger if exists cost_items_set_updated_at on public.cost_items;
create trigger cost_items_set_updated_at
  before update on public.cost_items
  for each row execute function public.set_updated_at();

-- 2) PRICE OBSERVATIONS — grow the existing cost_database ------------------
alter table public.cost_database
  add column if not exists item_id      uuid references public.cost_items (id) on delete set null,
  add column if not exists source       text default 'confirmed',  -- 'confirmed' | 'quote' | 'manual'
  add column if not exists region       text,                       -- e.g. 'CA' (data-pooling key)
  add column if not exists project_type text,                       -- snapshot of the job's type
  add column if not exists building_sf  numeric,                    -- snapshot of the job's size
  add column if not exists observed_on  date default current_date;  -- when the price was real

create index if not exists cost_database_item_idx on public.cost_database (item_id);

-- 3) PROJECTS — a structured region (defaults to California) ---------------
-- Free-text address stays; this is the clean field we stamp onto every price
-- so the data can later be sliced and pooled by region.
alter table public.projects
  add column if not exists region text;
