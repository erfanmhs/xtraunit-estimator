-- ============================================================================
-- XtraUnit Estimator — Phase 9: single total price per line
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Lets the user put ONE final price on a line without filling the five
-- buckets (labor/material/sub/equipment/other). Stored in cost_total;
-- price_mode 'total' means the line's price IS cost_total (buckets ignored).
-- Also added to cost_database so confirmed total-only prices join the history.
-- ============================================================================

alter table public.line_items
  add column if not exists cost_total numeric;

alter table public.cost_database
  add column if not exists cost_total numeric;
