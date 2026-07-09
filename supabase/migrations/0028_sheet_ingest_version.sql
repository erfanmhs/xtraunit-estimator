-- ============================================================================
-- XtraUnit Estimator — Sheet ingest version (re-read plans with better logic)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Records WHICH VERSION of the plan-reading logic last processed each sheet.
-- When we improve how plans are read (e.g. layout-aware text so tables survive,
-- plus rendering schedule sheets as images), bumping the app's version makes
-- already-prepared projects re-read themselves ONCE, automatically, so old
-- projects get the improved reading too. New default 0 = "needs a fresh read".
-- ============================================================================

alter table public.sheets add column if not exists ingest_version smallint not null default 0;
