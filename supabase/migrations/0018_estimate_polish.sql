-- ============================================================================
-- XtraUnit Estimator — estimate & proposal polish
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
--   estimates.building_sf      — building area, enables the $/SF benchmark
--   company_settings.signer_*  — who signs the proposal letter
-- ============================================================================

alter table public.estimates
  add column if not exists building_sf numeric;

alter table public.company_settings
  add column if not exists signer_name  text,
  add column if not exists signer_title text;
