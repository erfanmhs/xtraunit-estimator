-- ============================================================================
-- XtraUnit Estimator — Crop a sheet into a NEW sheet (non-destructive)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- The takeoff viewer's Crop tool draws a rectangle on a sheet (free, or held
-- to a standard paper shape — ARCH D, ANSI B, A4…) and saves it as a new
-- sheet of the same plan page. The original sheet and the PDF are untouched:
--   crop             {x, y, w, h} in PDF points, top-left origin, page scale 1
--   source_sheet_id  which sheet it was cropped from (kept for reference)
-- The cropped sheet has its own name, category, notes, scale and measurements,
-- and the AI reads only the cropped region of that page for it.
-- ============================================================================

alter table public.sheets
  add column if not exists crop            jsonb,
  add column if not exists source_sheet_id uuid references public.sheets (id) on delete set null;

create index if not exists sheets_source_sheet_id_idx on public.sheets (source_sheet_id);
