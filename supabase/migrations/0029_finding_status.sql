-- ============================================================================
-- XtraUnit Estimator — Finding status (clear Accept / Dismiss on each finding)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Replaces the ambiguous single checkbox on assumptions/gaps/exclusions with an
-- explicit decision: 'open' (undecided), 'accepted' (agree — keep it, optionally
-- with a note/correction), or 'dismissed' (not applicable — leave it out). The
-- note itself reuses the existing `answer` column and is fed into the next
-- Generate so a correction actually changes the estimate.
-- ============================================================================

alter table public.scope_findings
  add column if not exists status text not null default 'open';
