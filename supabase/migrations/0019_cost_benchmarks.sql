-- ============================================================================
-- XtraUnit Estimator — Price-per-SF benchmarks
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Your standard sell $/SF ranges by project type (ADU, multifamily, custom…),
-- stored as JSON on company_settings. The pricing AI reads these as a reality
-- anchor so its numbers land near what XtraUnit actually sells — the cure for
-- the cold-AI overshoot. You enter/edit them in Settings; nothing is hard-coded.
--
-- Shape: [{ "label": "ADU", "sell_low": 250, "sell_high": 300 }, ...]
-- ============================================================================

alter table public.company_settings
  add column if not exists benchmarks jsonb;
