-- ============================================================================
-- XtraUnit Estimator — Proposal redesign: interactive web proposal + share link
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- The proposal is now a web page the client opens on any device (with print /
-- PDF as the fallback). New per-project fields:
--   client_brief       the client's ask / constraint, in THEIR words (feeds the
--                      AI-drafted executive summary)
--   executive_summary  the tailored opening (~under 300 words)
--   valid_until        pricing expiry shown on the proposal ("valid 30 days")
--   options            tiered add-ons the client can toggle (Recommended /
--                      Enhanced on top of the Base bid); JSON array
--   timeline           start, milestones, and the dependencies/assumptions
--                      that sit on the critical path; JSON
--
-- The SHARE LINK: "Publish" writes a frozen snapshot of the whole proposal to
-- public_doc and mints an unguessable share_token. The public page reads the
-- snapshot through get_public_proposal() — a SECURITY DEFINER function, so no
-- row-level policy is opened and nothing but that one snapshot is reachable
-- by token. The client's "Accept" goes through accept_proposal() the same way
-- (typed-name acceptance — the e-sign stub). Re-publishing refreshes the
-- snapshot; clearing public_doc turns the link off.
-- ============================================================================

alter table public.proposals
  add column if not exists client_brief      text,
  add column if not exists executive_summary text,
  add column if not exists valid_until       date,
  add column if not exists options           jsonb not null default '[]'::jsonb,
  add column if not exists timeline          jsonb,
  add column if not exists share_token       text,
  add column if not exists public_doc        jsonb,
  add column if not exists published_at      timestamptz,
  add column if not exists accepted_at       timestamptz,
  add column if not exists accepted_by       jsonb;

create unique index if not exists proposals_share_token_idx
  on public.proposals (share_token)
  where share_token is not null;

-- Read one published proposal by its token. Returns null when the token is
-- unknown or the proposal isn't published. Tokens are ≥ 24 random chars.
create or replace function public.get_public_proposal(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select p.public_doc
         || jsonb_build_object(
              'accepted_at', p.accepted_at,
              'accepted_by', p.accepted_by
            )
  from public.proposals p
  where p.share_token = p_token
    and length(coalesce(p_token, '')) >= 24
    and p.public_doc is not null
  limit 1;
$$;

revoke all on function public.get_public_proposal(text) from public;
grant execute on function public.get_public_proposal(text) to anon, authenticated;

-- The client accepts (typed name = signature). Only once, only while the
-- pricing is still valid. Returns true when the acceptance was recorded.
create or replace function public.accept_proposal(
  p_token     text,
  p_name      text,
  p_email     text,
  p_selection jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if length(coalesce(p_token, '')) < 24
     or length(btrim(coalesce(p_name, ''))) < 2 then
    return false;
  end if;

  update public.proposals
     set accepted_at = now(),
         accepted_by = jsonb_build_object(
           'name',      left(btrim(p_name), 120),
           'email',     left(btrim(coalesce(p_email, '')), 200),
           'selection', coalesce(p_selection, '[]'::jsonb),
           'at',        now()
         )
   where share_token = p_token
     and public_doc is not null
     and accepted_at is null
     and (valid_until is null or valid_until >= current_date);

  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.accept_proposal(text, text, text, jsonb) from public;
grant execute on function public.accept_proposal(text, text, text, jsonb) to anon, authenticated;
