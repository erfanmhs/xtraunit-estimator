-- ============================================================================
-- XtraUnit Estimator — Phase 9: sub quotes
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- A sub quote is one lump sum from a trade partner (e.g. "ABC Plumbing —
-- $185,000") covering many scope lines at once. The quote document (PDF/photo)
-- can be uploaded and read by AI. Applying a quote spreads its total across
-- the covered lines (subcontractor bucket, status 'proposed' until confirmed).
-- ============================================================================

create table if not exists public.sub_quotes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  owner_id      uuid not null references auth.users (id) on delete cascade,

  sub_name      text not null,          -- 'ABC Plumbing'
  trade         text,                   -- plain-language trade ('Plumbing')
  division_codes text[],                -- CSI divisions covered, e.g. {'22'}
  quote_date    text,                   -- as printed on the quote
  total         numeric not null,

  file_path     text,                   -- storage path of the uploaded quote doc
  file_name     text,
  extracted     jsonb,                  -- AI extraction (line items, inclusions, exclusions)
  notes         text,
  created_at    timestamptz not null default now()
);

alter table public.sub_quotes enable row level security;

drop policy if exists "sub_quotes_select_own" on public.sub_quotes;
create policy "sub_quotes_select_own"
  on public.sub_quotes for select using (auth.uid() = owner_id);
drop policy if exists "sub_quotes_insert_own" on public.sub_quotes;
create policy "sub_quotes_insert_own"
  on public.sub_quotes for insert with check (auth.uid() = owner_id);
drop policy if exists "sub_quotes_update_own" on public.sub_quotes;
create policy "sub_quotes_update_own"
  on public.sub_quotes for update using (auth.uid() = owner_id);
drop policy if exists "sub_quotes_delete_own" on public.sub_quotes;
create policy "sub_quotes_delete_own"
  on public.sub_quotes for delete using (auth.uid() = owner_id);

create index if not exists sub_quotes_project_id_idx on public.sub_quotes (project_id);

-- Which quote covers a scope line (null = not covered by a quote).
alter table public.line_items
  add column if not exists sub_quote_id uuid references public.sub_quotes (id) on delete set null;

create index if not exists line_items_sub_quote_id_idx on public.line_items (sub_quote_id);
