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

- [ ] 0032_scope_run_cost.sql — adds `cost_usd`, `tokens_in`, `tokens_out`,
      `ai_calls` to `scope_runs` so each AI run records what it cost. The
      per-run spending cap works without it (it lives in the app); this just
      keeps the numbers. Safe to run anytime.
- [ ] 0034_job_queue.sql — the durable job queue. Turns the AI-run rows into
      real queue entries (queued → running → done) with heartbeats, attempts,
      a checkpoint of finished division groups, and two functions the worker
      uses to claim jobs and requeue orphaned ones. Together with the
      SUPABASE_SERVICE_ROLE_KEY on Render this makes Generate / Apply /
      Suggest prices survive a deploy or crash and lets the app run on more
      than one server. Without it the app keeps the old in-process behavior.
      Safe to run anytime.

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
