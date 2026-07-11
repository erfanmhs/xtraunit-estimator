-- ============================================================================
-- XtraUnit Estimator — Remember a project's trade selection
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- When a scope is generated for SPECIFIC trades, we save that selection here so
-- the next Regenerate defaults back to those same trades instead of resetting
-- to the full building. Empty array / null = full building.
-- ============================================================================

alter table public.projects add column if not exists gen_trades jsonb;
