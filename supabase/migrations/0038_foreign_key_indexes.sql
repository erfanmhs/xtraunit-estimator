-- 0038 — Index the foreign keys that didn't have one.
--
-- WHY THIS MATTERS
-- Twelve columns point at another table (a measurement points at its owner and
-- its plan file, a line item at its owner, and so on) but had no index. Two
-- things get slow without one:
--   * looking rows up by that column — which is exactly what the security
--     rules do on every single query (`owner_id = …`);
--   * deleting a parent row — Postgres has to scan the whole child table to
--     find what to cascade, so deleting a project or a sheet gets slower and
--     slower as the data grows.
--
-- These are small, ordinary indexes. They cost a little write speed and a
-- little disk, and they save far more on reads and deletes.
--
-- Safe to run more than once (`if not exists`). No data is touched.
-- Note: this runs as one statement per index and will briefly lock each table
-- while it builds. The tables are small today, so it finishes in seconds; run
-- it when nobody is mid-takeoff anyway.

create index if not exists idx_cost_database_project_id on public.cost_database (project_id);
create index if not exists idx_estimates_owner_id on public.estimates (owner_id);
create index if not exists idx_line_items_owner_id on public.line_items (owner_id);
create index if not exists idx_measurements_owner_id on public.measurements (owner_id);
create index if not exists idx_measurements_plan_file_id on public.measurements (plan_file_id);
create index if not exists idx_plan_files_owner_id on public.plan_files (owner_id);
create index if not exists idx_proposals_owner_id on public.proposals (owner_id);
create index if not exists idx_scope_findings_owner_id on public.scope_findings (owner_id);
create index if not exists idx_scope_findings_plan_file_id on public.scope_findings (plan_file_id);
create index if not exists idx_scope_runs_owner_id on public.scope_runs (owner_id);
create index if not exists idx_sheets_owner_id on public.sheets (owner_id);
create index if not exists idx_sub_quotes_owner_id on public.sub_quotes (owner_id);
