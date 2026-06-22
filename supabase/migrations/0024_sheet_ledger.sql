-- ============================================================================
-- XtraUnit Estimator — Per-sheet takeoff ledger (legend) placement
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Stores where the on-sheet "takeoff legend" sits and how big it is, per sheet,
-- as JSON: { "x": 0.72, "y": 0.05, "scale": 1, "visible": true }
--   x, y    — top-left position as a fraction of the page (0–1), so it stays
--             put at any zoom
--   scale   — size multiplier the user can grow/shrink
--   visible — whether the legend shows on the sheet (and in exports)
-- Null until the user turns the legend on for a sheet.
-- ============================================================================

alter table public.sheets
  add column if not exists ledger jsonb;
