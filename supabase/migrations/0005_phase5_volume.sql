-- ============================================================================
-- XtraUnit Estimator — Phase 5: Volume measurement fields
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- Adds the fields the Volume measure tool needs. Value is stored in cubic feet
-- (unit 'cf'); cubic yards are shown in the app as value / 27.
-- ============================================================================

alter table public.measurements add column if not exists vol_mode  text;     -- 'linear' | 'area'
alter table public.measurements add column if not exists vol_width numeric;   -- feet (linear runs only)
alter table public.measurements add column if not exists vol_depth numeric;   -- feet
