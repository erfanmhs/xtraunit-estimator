-- ============================================================================
-- XtraUnit Estimator — AI usage log (the guard on the Anthropic bill)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- One append-only row per AI run (scope / pricing / sub-quote read / proposal
-- drafts). Before each run the app counts a user's recent rows and refuses if
-- they're over the per-user daily / monthly cap. This is what stops a runaway
-- loop — or a stranger who signed up — from draining the AI budget.
--
-- Until this table exists the app "fails open" (no cap enforced), so running
-- this migration is what switches the protection ON.
-- ============================================================================

create table if not exists public.ai_usage (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  kind       text not null,              -- 'scope' | 'pricing' | 'subquote' | 'proposal' | 'profile'
  created_at timestamptz not null default now()
);

alter table public.ai_usage enable row level security;

-- Append-only from the user's side: they may see and add their own rows, never
-- edit or delete them (so the usage count can't be gamed).
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own"
  on public.ai_usage for select using (auth.uid() = owner_id);

drop policy if exists "ai_usage_insert_own" on public.ai_usage;
create policy "ai_usage_insert_own"
  on public.ai_usage for insert with check (auth.uid() = owner_id);

-- Fast "how many runs since <time> for this user" lookups.
create index if not exists ai_usage_owner_created_idx
  on public.ai_usage (owner_id, created_at desc);
