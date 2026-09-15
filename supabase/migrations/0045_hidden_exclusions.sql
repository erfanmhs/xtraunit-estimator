-- ============================================================================
-- XtraUnit Estimator — 0045: standard exclusions hidden per project
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- The company's standard exclusions (Settings → Proposal profile) print on
-- every proposal. The Scope page now shows the whole "Excluded / by others"
-- list the client reads and lets the estimator hide a standard item on ONE
-- project without touching the company wording. The hidden ones are kept
-- here, by their text.
-- ============================================================================

alter table public.projects
  add column if not exists hidden_exclusions jsonb not null default '[]'::jsonb;

comment on column public.projects.hidden_exclusions is
  'Standard exclusions (by text) left off this project''s proposal. Settings keeps the wording.';
