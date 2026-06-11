-- ============================================================================
-- XtraUnit Estimator — Phase 1 schema: profiles + projects
-- Run this in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run (uses "if not exists" / "or replace").
-- ============================================================================

-- 1) PROFILES ----------------------------------------------------------------
-- One row per signed-in user, linked to Supabase's built-in auth.users.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'member',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can see and edit only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Automatically create a profile row whenever a new user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) PROJECTS ----------------------------------------------------------------
-- A job to bid. More tables (plans, line items, pricing) come in later phases.
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  client_name  text,
  address      text,
  project_type text,
  status       text not null default 'draft',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.projects enable row level security;

-- For now, each user sees and manages only the projects they created.
-- (Team/company sharing comes later, once we add an organization model.)
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
  on public.projects for select
  using (auth.uid() = owner_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects for insert
  with check (auth.uid() = owner_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
  on public.projects for update
  using (auth.uid() = owner_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
  on public.projects for delete
  using (auth.uid() = owner_id);

-- Keep updated_at fresh on every change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create index if not exists projects_owner_id_idx on public.projects (owner_id);
