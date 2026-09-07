-- 0036 — Lock down the background-worker database functions.
--
-- WHY THIS MATTERS
-- `claim_next_job` and `reclaim_orphaned_jobs` run as SECURITY DEFINER: they
-- deliberately bypass row-level security, because the background worker has to
-- see and update every user's jobs. But they were also executable by `anon`
-- and `authenticated` — and the anon key is public by design (it ships inside
-- every browser page). So anyone could call them and:
--   * claim jobs that aren't theirs and read the payload (project + owner ids);
--   * stall AI generation — a job claimed by a stranger is never processed, so
--     it sits "running" until the orphan sweep, retries, and finally fails.
-- Only the worker (service_role, via SUPABASE_SERVICE_ROLE_KEY) should reach
-- them. Revoking EXECUTE closes that door; nothing in the app calls these from
-- the browser, so there is no behaviour change.
--
-- `handle_new_user` is a trigger function — it never needs to be callable
-- directly over the API either.
--
-- `get_public_proposal` and `accept_proposal` are LEFT ALONE on purpose: the
-- client's share link is opened by people who are not signed in, so `anon`
-- must be able to call those two. That is the design, not an oversight.
--
-- Also sets a fixed search_path on `set_updated_at` (the last function without
-- one), so it can't be influenced by a caller's search_path.
--
-- Safe to run more than once. No data is touched.

-- ── Worker-only job queue functions ─────────────────────────────────────────
revoke all on function public.claim_next_job(p_worker text)
  from public, anon, authenticated;
grant execute on function public.claim_next_job(p_worker text)
  to service_role;

revoke all on function public.reclaim_orphaned_jobs(p_stale_seconds integer)
  from public, anon, authenticated;
grant execute on function public.reclaim_orphaned_jobs(p_stale_seconds integer)
  to service_role;

-- ── Trigger function: never called directly ─────────────────────────────────
revoke all on function public.handle_new_user()
  from public, anon, authenticated;

-- ── Pin the last mutable search_path ────────────────────────────────────────
alter function public.set_updated_at() set search_path = public;
