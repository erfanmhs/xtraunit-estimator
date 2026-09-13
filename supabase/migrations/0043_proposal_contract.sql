-- ============================================================================
-- XtraUnit Estimator — 0043: the contract block on a proposal
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- A proposal the client accepts in the document IS the contract. For work on
-- someone's home, California (Business & Professions Code §7159, 2026) says
-- exactly what that contract must contain: approximate start and completion
-- dates, a down payment capped at $1,000 or 10 %, a schedule of progress
-- payments by phase, whether subcontractors will be used, whether the buyer
-- is a senior (five-day instead of three-day right to cancel), and a set of
-- statutory notices. The notices are fixed text in the app; the per-project
-- answers live here, as one JSON block, so no further columns are needed as
-- the form grows.
-- ============================================================================

alter table public.proposals
  add column if not exists contract jsonb;

comment on column public.proposals.contract is
  'Per-proposal contract answers: home_improvement, senior, uses_subcontractors, start_date, completion_date, downpayment, progress_payments[]. See src/lib/proposal/contract.ts.';
