-- ============================================================================
-- XtraUnit Estimator — Sheet custom names
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- Adds an editable display name per sheet (falls back to "Sheet N" in the app).
-- ============================================================================

alter table public.sheets add column if not exists name text;
