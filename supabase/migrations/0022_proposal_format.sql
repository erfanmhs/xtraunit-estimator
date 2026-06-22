-- ============================================================================
-- XtraUnit Estimator — Proposal format (full XtraUnit layout)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Brings the in-app proposal up to XtraUnit's real proposal structure:
--   • company_settings.proposal_profile — the standard, reusable sections
--     (Who We Are, Why We're the Right Fit, Next Steps, A-license note, finish
--     note). Set up once, reused on every proposal. JSON; falls back to a
--     built-in default if empty.
--   • proposals — the project-specific narrative + the Bid Summary inputs:
--       project_description  — what the project is (units, stories, type)
--       understanding        — "Our Understanding of the Project"
--       estimated_duration   — e.g. "18-21 months"
--       anticipated_start    — e.g. "Q1 2026"
--       table_style          — 'priced' (line costs) or 'status' (Included/Excluded)
--   (Building SF for the $/SF lines already lives on estimates.building_sf.)
-- ============================================================================

alter table public.company_settings
  add column if not exists proposal_profile jsonb;

alter table public.proposals
  add column if not exists project_description text,
  add column if not exists understanding      text,
  add column if not exists estimated_duration  text,
  add column if not exists anticipated_start   text,
  add column if not exists table_style         text default 'priced';
