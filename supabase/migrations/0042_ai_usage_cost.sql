-- ============================================================================
-- XtraUnit Estimator — 0042: a real dollar budget for AI spend
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- The AI cap so far counted RUNS per user (60 a day, 600 a month). That is a
-- volume guardrail, not a spending limit: one run can cost 5¢ or $5. Every
-- background job already records its dollar cost on `scope_runs` (0032);
-- this gives the one-shot AI calls that are NOT jobs — reading a sub's
-- quote, drafting the proposal letter, the company profile, tidying sheet
-- notes — a place to record theirs too, on the `ai_usage` row that
-- `enforceAiLimit` already writes for every AI start.
--
-- The monthly budget (AI_MONTHLY_BUDGET_USD, default $25 per user) is then
-- the sum of both. Job kinds leave ai_usage.cost_usd null, so nothing is
-- counted twice.
--
-- Also: the app must UPDATE its own ai_usage row to settle the cost after
-- the call, and 0027 only granted select + insert.
-- ============================================================================

alter table public.ai_usage
  add column if not exists cost_usd numeric(10, 4);

drop policy if exists "ai_usage_update_own" on public.ai_usage;
create policy "ai_usage_update_own"
  on public.ai_usage for update
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
