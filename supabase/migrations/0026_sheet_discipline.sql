-- ============================================================================
-- XtraUnit Estimator — Sheet discipline (retrieval/routing layer)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Each sheet gets a DISCIPLINE (architectural / structural / mep / plumbing /
-- electrical / civil / …). It's worked out automatically from the sheet's
-- triage label and number, but storing it lets you CORRECT a mis-sorted sheet.
-- Scope generation routes each CSI division to only the sheets it needs (plus
-- the shared cover / notes / schedules / architectural), so the AI stops wading
-- through unrelated trades' sheets.
--
-- Nullable + no backfill on purpose: any sheet left NULL is classified on the
-- fly at generation time, so existing projects keep working with no data edit.
-- ============================================================================

alter table public.sheets add column if not exists discipline text;
