-- ============================================================================
-- XtraUnit Estimator — record what each AI run cost
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Every background AI job (scope generation, apply-findings, pricing) now
-- meters its own Anthropic spend from the token counts on each response and
-- stops at a per-run ceiling (AI_JOB_BUDGET_USD, default $15). These columns
-- keep the result on the run row so cost per project is visible later and a
-- true dollar-based daily/monthly cap can be built on real numbers.
--
-- The app writes them best-effort: until this is run, the update is simply
-- skipped (the cap itself still works — it lives in the app, not the DB).
-- ============================================================================

alter table public.scope_runs
  add column if not exists cost_usd   numeric(10, 4),   -- estimated $ for the run
  add column if not exists tokens_in  bigint,           -- input + cache write + cache read
  add column if not exists tokens_out bigint,           -- output tokens
  add column if not exists ai_calls   integer;          -- number of model calls
