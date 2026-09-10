-- ============================================================================
-- XtraUnit Estimator — 0040: arranging or archiving a project is not "work"
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Every project card shows "Updated <date>", fed by `updated_at`, which a
-- trigger from 0001 bumps on ANY change to the row. Dragging the list into a
-- new order (feedback A2/A3) rewrites `sort_order` on every project, and
-- archiving writes `archived_at` — so one drag would stamp today's date on
-- every job, and "Updated" would stop meaning anything.
--
-- This gives `projects` its own trigger function: if the only columns that
-- changed are sort_order / archived_at, updated_at is left alone. Anything
-- else still bumps it exactly as before. The shared set_updated_at() from
-- 0001 is untouched (cost_items still uses it).
--
-- Until this runs everything works; the dates are just noisier than they
-- should be after a reorder.
-- ============================================================================

create or replace function public.projects_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  housekeeping constant text[] := array['sort_order', 'archived_at', 'updated_at'];
begin
  if (to_jsonb(new) - housekeeping) is not distinct from (to_jsonb(old) - housekeeping) then
    new.updated_at = old.updated_at;   -- only housekeeping columns changed
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.projects_set_updated_at();
