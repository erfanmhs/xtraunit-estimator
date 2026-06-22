-- ============================================================================
-- XtraUnit Estimator — Standard unit prices
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Your standard DIRECT unit costs (door, tile/sf, mini-split, panel upgrade…),
-- stored as JSON on company_settings. The pricing AI reads these as a reference
-- so individual line items price from XtraUnit's real numbers, not market guesses.
-- You edit them in Settings; nothing is hard-coded.
--
-- Shape: [{ "item": "Interior door", "unit": "ea", "cost": 85 }, ...]
-- ============================================================================

alter table public.company_settings
  add column if not exists unit_prices jsonb;
