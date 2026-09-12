# Backups and restore

**Why this exists.** The estimator's Supabase project is on the free tier,
which keeps **no backups**. Every takeoff, scope line, price and proposal
lives in one Postgres database. Until 2026-09-12 a lost database meant lost
work, full stop. Now a GitHub Action dumps it every night at 2 am Pacific and
keeps each dump for 90 days, and a second Action restores any of them on
demand.

## Status (2026-09-12)

Set up and proven the same day: backup run #2 captured 15 tables (432 KB),
restore run #2 rebuilt them in the scratch project `xtraunit-restore-test`
and the counts matched production exactly (10 projects, 166 sheets, 299
measurements, 757 scope lines, 447 findings, 34 runs, 4 users). Both
secrets are in place. Nightly runs start tonight. UptimeRobot monitor
"XtraUnit Estimator" watches `/api/health` every 5 minutes → email.

Next drill due: December 2026. Open the scratch project in Supabase first —
free projects pause after a week idle; click "Restore project" if it did.

## One-time setup (Erfan, about ten minutes)

1. **The production connection string.** Supabase dashboard → the project →
   **Connect** (top bar) → choose **Session pooler** → copy the URI. It looks
   like `postgresql://postgres.rqyestlkzfdxwwvbfgwp:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with the database password (Project Settings →
   Database → Reset if you no longer have it).
   *Use the Session pooler, not the direct host: GitHub's machines have no
   IPv6 and the direct host is IPv6-only.*
2. GitHub → the repo → **Settings → Secrets and variables → Actions → New
   repository secret** → name `SUPABASE_DB_URL`, paste the URI, save.
3. **Actions** tab → **Backup database** → **Run workflow**. Green in about
   two minutes. The run's summary shows the tables it captured.
4. **The scratch database, for drills.** Create a second, free Supabase
   project (any name, e.g. `xtraunit-restore-test`). Get *its* Session
   pooler URI the same way and save it as the secret `RESTORE_DB_URL`.
5. **Actions** → **Restore database from a backup** → **Run workflow** →
   paste the backup run's id (the number at the end of its URL), type
   `scratch`, run. When it finishes, the log ends with a row count per table.
   If projects / sheets / measurements / line_items match what you expect,
   the backup is proven good.

Do step 5 once now, and again whenever you think of it (once a quarter is
plenty). A backup that has never been restored is a hope, not a backup.

## If the database is ever lost

1. Actions → **Restore database from a backup** → last night's run id →
   `scratch` → run. Check the counts.
2. Render → the estimator service → **Environment** → change
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and
   `SUPABASE_SERVICE_ROLE_KEY` if set) to the scratch project's values
   (Supabase → Project Settings → API). Save; Render redeploys.
3. The app is back with the data as of 2 am that morning. Anything done
   since is gone — that is the cost of nightly, not continuous, backups.
4. Re-upload plan PDFs (see below) as you open each project.

To restore INTO production instead (the database exists but the data is
wrong), run the restore with `production` as the confirm word. It replaces
every table with that night's copy.

## What is NOT in the backup, honestly

- **Uploaded plan PDFs and quote photos** live in Supabase Storage, not in
  the database. They are not dumped. The originals are on your computer or
  in email, so they can be re-uploaded; the measurements drawn on them are in
  the database and come back with it, and re-attach as long as the sheet is
  re-uploaded under the same project. Backing Storage up nightly is possible
  (a few hundred MB a night) — say so if you want it.
- **User accounts** (the `auth` schema) belong to Supabase and are not dumped.
  On a fresh project you create the account again with the same email; the
  data's `owner_id` will need one SQL update to point at the new user id.
  Ask before doing this; it is one line but it is the one line that matters.
- **Anything after 2 am.** Nightly means up to a day of work at risk.
  Continuous backups need Supabase Pro ($25/mo), which is also what lifts the
  50 MB upload limit.

## What the restore log will say, and what is normal

- `pg_restore: warning: errors ignored on restore: N` with the exit code 1
  is expected. The dump carries a few Supabase-owned objects (extensions,
  the `graphql` and `pgsodium` hooks) that the target already has.
- Any error mentioning `schema "auth" does not exist` means the target is
  not a Supabase project. Every table's `owner_id` points at `auth.users`
  and every access policy calls `auth.uid()`; on a plain Postgres the
  foreign keys and policies are skipped, on a Supabase project (scratch or
  production) they restore. Proven on a local drill 2026-09-12: with an
  `auth` schema present, `p_own` policies and row security came back exactly.
- The last step prints rows per table. Those numbers, not the exit code,
  are the verdict.

## Where to look when something is off

- A red **Backup database** run: open it. "SUPABASE_DB_URL secret is not
  set" means step 2 was skipped. A connection error means the password
  changed — redo step 1 and 2.
- The 90-day window: artifacts older than that are deleted by GitHub. If
  you want years of history, the same dump can be pushed to a private repo
  or a bucket instead — one more secret, say the word.
