-- ============================================================================
-- XtraUnit Estimator — Phase 11: Proposals
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- One proposal per project: the editable cover letter (AI-drafted, user-owned
-- after editing) plus the addressing fields. The cost table, assumptions and
-- exclusions are always assembled live from the scope/pricing/estimate data.
-- ============================================================================

create table if not exists public.proposals (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null unique references public.projects (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,

  letter_text    text,        -- the cover letter body
  client_name    text,        -- "To:" override (defaults to the project's client)
  proposal_date  text,        -- as shown on the document

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.proposals enable row level security;

drop policy if exists "proposals_select_own" on public.proposals;
create policy "proposals_select_own"
  on public.proposals for select using (auth.uid() = owner_id);
drop policy if exists "proposals_insert_own" on public.proposals;
create policy "proposals_insert_own"
  on public.proposals for insert with check (auth.uid() = owner_id);
drop policy if exists "proposals_update_own" on public.proposals;
create policy "proposals_update_own"
  on public.proposals for update using (auth.uid() = owner_id);
drop policy if exists "proposals_delete_own" on public.proposals;
create policy "proposals_delete_own"
  on public.proposals for delete using (auth.uid() = owner_id);
