-- ============================================================================
-- XtraUnit Estimator — Plan ingest: cache each sheet's text in the database
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Instead of sending heavy PDFs to the AI every time, we extract each sheet's
-- text ONCE (schedules, notes, callouts) and store it here. Scope generation
-- then reads this cheap text. Image-only sheets (no text layer) are flagged so
-- they can get a one-time AI vision read instead.
-- ============================================================================

alter table public.sheets add column if not exists extracted_text text;
alter table public.sheets add column if not exists ingest_method text;   -- 'text' | 'image' | null
alter table public.sheets add column if not exists ingested_at timestamptz;
