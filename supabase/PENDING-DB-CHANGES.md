# Database changes to run

This is the running list of database changes for the estimator. When a new
feature needs a change to the database, the SQL gets written into a numbered
file in `supabase/migrations/` and listed here under **To run**. You run each
one once in Supabase, then it moves to **Already run**.

**How to run one:**
1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open the migration file listed below, copy everything in it, paste it in.
3. Click **Run**. (These are written to be safe to run more than once.)
4. Tell me it's done, or just check it off here.

---

## To run

- [ ] 0044_company_branding.sql — adds a `branding` column to `company_settings`
  (logo, colour, theme, slogan, tagline, voice, job types) and marks existing
  accounts as onboarded so the welcome wizard greets only new ones. Until it
  runs, Settings → Branding can't save; everything else works.
- [ ] 0043_proposal_contract.sql — adds a `contract` column to `proposals` for the
  California home improvement contract answers (dates, down payment, progress
  payments, subcontractors, senior buyer). Until it runs, the proposal page still
  works; the contract section shows the defaults and can't be saved.


---

## Already run

- [x] 0001_phase1_projects.sql
- [x] 0002_phase2_plans.sql
- [x] 0003_phase3_sheets.sql
- [x] 0004_phase5_measurements.sql
- [x] 0005_phase5_volume.sql — run 2026-06-08
- [x] 0006_sheet_name.sql — run 2026-06-08
- [x] 0007_phase7_scope.sql — run 2026-06-08
- [x] 0008_scope_runs.sql — run 2026-06-08
- [x] 0009_sheet_text.sql — run 2026-06-08
- [x] 0010_scope_clarifications.sql — run 2026-06-10
- [x] 0011_phase9_pricing.sql — run 2026-06-10
- [x] 0012_price_total.sql — run 2026-06-10
- [x] 0013_phase10_estimate.sql — run 2026-06-10
- [x] 0014_cost_db_section.sql — run 2026-06-10
- [x] 0015_sub_quotes.sql — run 2026-06-10
- [x] 0016_company_settings.sql — run 2026-06-10
- [x] 0017_phase11_proposals.sql — run 2026-06-10
- [x] 0018_estimate_polish.sql — run 2026-06-15
- [x] 0019_cost_benchmarks.sql — run 2026-06-15
- [x] 0020_unit_prices.sql — run 2026-06-15
- [x] 0021_cost_observations_items.sql — run 2026-06-17
- [x] 0022_proposal_format.sql — run 2026-06-19
- [x] 0023_measurement_leaders.sql — run 2026-06-19
- [x] 0024_sheet_ledger.sql — run 2026-06-19
- [x] 0025_plan_vision_pdf.sql — run 2026-07-03
- [x] 0026_sheet_discipline.sql — run 2026-07-07
- [x] 0027_ai_usage.sql — run 2026-07-07
- [x] 0028_sheet_ingest_version.sql — run (columns verified present 2026-09-05)
- [x] 0029_finding_status.sql — run (verified 2026-09-05)
- [x] 0030_project_gen_trades.sql — run (verified 2026-09-05)
- [x] 0031_finding_options.sql — run (verified 2026-09-05)
- [x] 0032_scope_run_cost.sql — run 2026-09-06 (per-run AI cost columns on `scope_runs`; verified)
- [x] 0033_proposal_redesign.sql — run 2026-09-06 (web proposal fields, share link, `get_public_proposal` / `accept_proposal`; verified)
- [x] 0034_job_queue.sql — run 2026-09-06 (durable job queue columns, `claim_next_job` / `reclaim_orphaned_jobs`; verified)
- [x] 0035_sheet_crop.sql — run 2026-09-06 (`sheets.crop` + `source_sheet_id`; verified)
- [x] 0036_lock_down_worker_functions.sql — run 2026-09-07 (claim_next_job,
      reclaim_orphaned_jobs and handle_new_user are now service_role only;
      set_updated_at has a fixed search_path; verified)
- [x] 0037_rls_auth_initplan.sql — run 2026-09-07 (all 55 policies now
      evaluate the user once per query; verified, 0 left per-row)
- [x] 0038_foreign_key_indexes.sql — run 2026-09-07 (all 12 indexes present;
      verified)
- [x] 0039_project_archive_and_order.sql — run 2026-09-08 (archived_at + sort_order verified present 2026-09-08)
- [x] 0040_projects_housekeeping_updated_at.sql — run 2026-09-09 (projects_set_updated_at trigger verified; a sort_order change left updated_at untouched)
- [x] 0041_line_items_trade_packages.sql — run 2026-09-09 (five trade columns + line_items_project_trade_idx verified present)
- [x] 0042_ai_usage_cost.sql — run 2026-09-12
