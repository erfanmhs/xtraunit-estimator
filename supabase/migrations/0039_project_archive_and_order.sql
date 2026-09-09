-- ============================================================================
-- XtraUnit Estimator — 0039: archive a project, and put projects in your order
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Two additions to `projects`, both for the 2026-09-08 feedback round:
--
--   archived_at  Feedback A1 / B1 — "minimize" a project. Archiving is NOT
--                deleting: the project and everything under it stay exactly
--                as they are, it just leaves the main list. Nullable
--                timestamp rather than a boolean so we also know WHEN, which
--                makes "archived last March" answerable later.
--
--   sort_order   Feedback A2 / A3 — hold a project to reorder the list, iOS
--                home-screen style. Without a stored order the arrangement
--                would reset on every reload, which is worse than not having
--                it. Lower numbers sort first; new projects go to the top.
--
-- No RLS changes: both columns live on `projects`, which is already locked to
-- `(select auth.uid()) = owner_id` by the existing policies.
-- ============================================================================

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists sort_order  integer;

-- Seed the order from what the list shows today (newest first), so the very
-- first drag starts from the arrangement the user is already looking at
-- instead of shuffling everything. Only touches rows that have no order yet,
-- so re-running this never re-shuffles a list someone has arranged.
with ranked as (
  select id, row_number() over (
           partition by owner_id order by created_at desc
         ) as rn
  from public.projects
  where sort_order is null
)
update public.projects p
set sort_order = ranked.rn
from ranked
where p.id = ranked.id;

-- The list is always "my projects, unarchived, in my order".
create index if not exists idx_projects_owner_sort
  on public.projects (owner_id, sort_order);

create index if not exists idx_projects_owner_archived
  on public.projects (owner_id, archived_at);
