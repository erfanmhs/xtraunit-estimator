-- ============================================================================
-- XtraUnit Estimator — cost database: store the CSI section
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Confirmed prices now remember their 6-digit CSI section ("06 10 00") in
-- addition to the division. History matching uses it as a tie-breaker so
-- "the same work item" matches more precisely on future jobs.
-- ============================================================================

alter table public.cost_database
  add column if not exists section_code text;
