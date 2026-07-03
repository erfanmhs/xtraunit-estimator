-- ============================================================================
-- XtraUnit Estimator — compact "vision PDF" for scanned/image-only plans
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Scanned plan sets have no text layer, and the original PDF is far too large to
-- send to the AI (Anthropic rejects PDFs over ~32 MB / 100 pages). During the
-- "Prepare plans" step the browser now renders the image-only sheets to
-- downscaled JPEGs and assembles a small PDF of just those pages; its storage
-- path is saved here, and scope generation sends THAT to the AI instead.
-- ============================================================================

alter table public.plan_files
  add column if not exists vision_pdf_path text;
