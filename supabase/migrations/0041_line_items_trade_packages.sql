-- ============================================================================
-- XtraUnit Estimator — 0041: the scope gets a trade-package layer
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- The scope of work used to be one flat list, one row per CSI section, in
-- division-code order. That is a filing system for specifications, not a
-- scope a client can read or a sub can bid. docs/SCOPE-WBS-DESIGN.md adds a
-- level between "the project" and "a line": the TRADE PACKAGE — what one sub
-- bids, what the client reads, and (later) what a schedule bar hangs off.
--
-- Five additive columns on `line_items`. Nothing is renamed or dropped;
-- division_code / section_code stay exactly as they are and keep feeding the
-- Cost Database.
--
--   trade_package   the Level-2 heading, e.g. "Plumbing", "Framing"
--   trade_sequence  construction order of that package (lower first)
--   deliverable     the plain-language noun the client reads
--                   ("Fixture set — 2 baths, kitchen, laundry")
--   includes        one sentence: what the line covers
--   excludes        one sentence: what it deliberately does not
--
-- Rows written before this migration have all five empty. The app files
-- those by their CSI section on the fly (src/lib/scope/trades.ts), so every
-- existing project already reads by trade the moment the code deploys; the
-- next AI generate fills the columns in properly. No back-fill needed.
-- ============================================================================

alter table public.line_items
  add column if not exists trade_package  text,
  add column if not exists trade_sequence integer,
  add column if not exists deliverable    text,
  add column if not exists includes       text,
  add column if not exists excludes       text;

-- The scope canvas and the proposal read a project's lines grouped by trade.
create index if not exists line_items_project_trade_idx
  on public.line_items (project_id, trade_sequence, sort_order);
