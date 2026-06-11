-- ============================================================================
-- XtraUnit Estimator — Phase 7: answer-the-questions loop
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Lets the user answer the AI's "question" findings. The answer is stored on the
-- finding row; on the next Generate it's fed back to the AI as an authoritative
-- clarification (and the AI is told not to re-ask it). Answered findings are
-- preserved across a regenerate so the answers stick.
-- ============================================================================

alter table public.scope_findings
  add column if not exists answer      text,
  add column if not exists answered_at timestamptz;
