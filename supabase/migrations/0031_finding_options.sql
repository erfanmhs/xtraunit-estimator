-- ============================================================================
-- XtraUnit Estimator — Quick-answer choices for review questions
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Each "question" finding can carry 2–4 short answer choices (the AI's most
-- likely answer first) so the user taps a chip instead of typing. Stored as a
-- JSON array of strings; empty/absent for non-question findings.
-- ============================================================================

alter table public.scope_findings add column if not exists options jsonb;
