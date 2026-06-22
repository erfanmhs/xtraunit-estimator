-- ============================================================================
-- XtraUnit Estimator — Leader/text annotations on the takeoff viewer
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Adds three fields to measurements so a "leader" annotation (an arrow that
-- points at something with a text note) can be stored alongside takeoff runs:
--   text       — the note shown at the text box
--   font_size  — text size, in PDF points (user can grow/shrink it)
--   head_size  — arrowhead size, in PDF points (user can grow/shrink it)
-- These are null for normal measurements; only leaders use them.
-- ============================================================================

alter table public.measurements
  add column if not exists text      text,
  add column if not exists font_size numeric,
  add column if not exists head_size numeric;
