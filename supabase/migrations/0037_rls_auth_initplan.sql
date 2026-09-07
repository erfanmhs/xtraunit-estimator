-- 0037 — Make the security rules stop re-checking the user on every row.
--
-- WHY THIS MATTERS
-- Every table's row-level security policy said `auth.uid() = owner_id`.
-- Postgres treats `auth.uid()` there as something it must call again for EVERY
-- ROW it looks at. On a project with thousands of line items or measurements
-- that is thousands of redundant calls per query.
--
-- Wrapping it as `(select auth.uid())` makes Postgres work it out ONCE per
-- query and reuse the answer (an "initplan"). Identical rules, identical
-- results — each user still only ever sees their own rows — just far less
-- work. This is Supabase's own recommended fix for the `auth_rls_initplan`
-- warning, and it gets more valuable as the data grows.
--
-- 56 policies across 15 tables. `alter policy` only swaps the expression, so
-- no policy is ever dropped and there is no window where a table is
-- unprotected. Safe to run more than once. No data is touched.

alter policy ai_usage_insert_own on public.ai_usage
  with check (((select auth.uid()) = owner_id));
alter policy ai_usage_select_own on public.ai_usage
  using (((select auth.uid()) = owner_id));
alter policy company_settings_delete_own on public.company_settings
  using (((select auth.uid()) = owner_id));
alter policy company_settings_insert_own on public.company_settings
  with check (((select auth.uid()) = owner_id));
alter policy company_settings_select_own on public.company_settings
  using (((select auth.uid()) = owner_id));
alter policy company_settings_update_own on public.company_settings
  using (((select auth.uid()) = owner_id));
alter policy cost_database_delete_own on public.cost_database
  using (((select auth.uid()) = owner_id));
alter policy cost_database_insert_own on public.cost_database
  with check (((select auth.uid()) = owner_id));
alter policy cost_database_select_own on public.cost_database
  using (((select auth.uid()) = owner_id));
alter policy cost_database_update_own on public.cost_database
  using (((select auth.uid()) = owner_id));
alter policy cost_items_delete_own on public.cost_items
  using (((select auth.uid()) = owner_id));
alter policy cost_items_insert_own on public.cost_items
  with check (((select auth.uid()) = owner_id));
alter policy cost_items_select_own on public.cost_items
  using (((select auth.uid()) = owner_id));
alter policy cost_items_update_own on public.cost_items
  using (((select auth.uid()) = owner_id));
alter policy estimates_delete_own on public.estimates
  using (((select auth.uid()) = owner_id));
alter policy estimates_insert_own on public.estimates
  with check (((select auth.uid()) = owner_id));
alter policy estimates_select_own on public.estimates
  using (((select auth.uid()) = owner_id));
alter policy estimates_update_own on public.estimates
  using (((select auth.uid()) = owner_id));
alter policy line_items_delete_own on public.line_items
  using (((select auth.uid()) = owner_id));
alter policy line_items_insert_own on public.line_items
  with check (((select auth.uid()) = owner_id));
alter policy line_items_select_own on public.line_items
  using (((select auth.uid()) = owner_id));
alter policy line_items_update_own on public.line_items
  using (((select auth.uid()) = owner_id));
alter policy measurements_delete_own on public.measurements
  using (((select auth.uid()) = owner_id));
alter policy measurements_insert_own on public.measurements
  with check (((select auth.uid()) = owner_id));
alter policy measurements_select_own on public.measurements
  using (((select auth.uid()) = owner_id));
alter policy measurements_update_own on public.measurements
  using (((select auth.uid()) = owner_id));
alter policy plan_files_delete_own on public.plan_files
  using (((select auth.uid()) = owner_id));
alter policy plan_files_insert_own on public.plan_files
  with check (((select auth.uid()) = owner_id));
alter policy plan_files_select_own on public.plan_files
  using (((select auth.uid()) = owner_id));
alter policy profiles_select_own on public.profiles
  using (((select auth.uid()) = id));
alter policy profiles_update_own on public.profiles
  using (((select auth.uid()) = id));
alter policy projects_delete_own on public.projects
  using (((select auth.uid()) = owner_id));
alter policy projects_insert_own on public.projects
  with check (((select auth.uid()) = owner_id));
alter policy projects_select_own on public.projects
  using (((select auth.uid()) = owner_id));
alter policy projects_update_own on public.projects
  using (((select auth.uid()) = owner_id));
alter policy proposals_delete_own on public.proposals
  using (((select auth.uid()) = owner_id));
alter policy proposals_insert_own on public.proposals
  with check (((select auth.uid()) = owner_id));
alter policy proposals_select_own on public.proposals
  using (((select auth.uid()) = owner_id));
alter policy proposals_update_own on public.proposals
  using (((select auth.uid()) = owner_id));
alter policy scope_findings_delete_own on public.scope_findings
  using (((select auth.uid()) = owner_id));
alter policy scope_findings_insert_own on public.scope_findings
  with check (((select auth.uid()) = owner_id));
alter policy scope_findings_select_own on public.scope_findings
  using (((select auth.uid()) = owner_id));
alter policy scope_findings_update_own on public.scope_findings
  using (((select auth.uid()) = owner_id));
alter policy scope_runs_delete_own on public.scope_runs
  using (((select auth.uid()) = owner_id));
alter policy scope_runs_insert_own on public.scope_runs
  with check (((select auth.uid()) = owner_id));
alter policy scope_runs_select_own on public.scope_runs
  using (((select auth.uid()) = owner_id));
alter policy scope_runs_update_own on public.scope_runs
  using (((select auth.uid()) = owner_id));
alter policy sheets_delete_own on public.sheets
  using (((select auth.uid()) = owner_id));
alter policy sheets_insert_own on public.sheets
  with check (((select auth.uid()) = owner_id));
alter policy sheets_select_own on public.sheets
  using (((select auth.uid()) = owner_id));
alter policy sheets_update_own on public.sheets
  using (((select auth.uid()) = owner_id));
alter policy sub_quotes_delete_own on public.sub_quotes
  using (((select auth.uid()) = owner_id));
alter policy sub_quotes_insert_own on public.sub_quotes
  with check (((select auth.uid()) = owner_id));
alter policy sub_quotes_select_own on public.sub_quotes
  using (((select auth.uid()) = owner_id));
alter policy sub_quotes_update_own on public.sub_quotes
  using (((select auth.uid()) = owner_id));
