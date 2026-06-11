-- ============================================================================
-- XtraUnit Estimator — Phase 2: plan file storage
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ============================================================================

-- 1) A record for each uploaded plan file -----------------------------------
create table if not exists public.plan_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  file_name    text not null,
  storage_path text not null,
  size_bytes   bigint,
  mime_type    text,
  created_at   timestamptz not null default now()
);

alter table public.plan_files enable row level security;

drop policy if exists "plan_files_select_own" on public.plan_files;
create policy "plan_files_select_own"
  on public.plan_files for select using (auth.uid() = owner_id);

drop policy if exists "plan_files_insert_own" on public.plan_files;
create policy "plan_files_insert_own"
  on public.plan_files for insert with check (auth.uid() = owner_id);

drop policy if exists "plan_files_delete_own" on public.plan_files;
create policy "plan_files_delete_own"
  on public.plan_files for delete using (auth.uid() = owner_id);

create index if not exists plan_files_project_id_idx
  on public.plan_files (project_id);

-- 2) A private storage bucket to physically hold the PDFs --------------------
insert into storage.buckets (id, name, public)
values ('plans', 'plans', false)
on conflict (id) do nothing;

-- 3) Storage access rules ----------------------------------------------------
-- Files are stored under "<user-id>/<project-id>/<file>", so each user can
-- only read/write/delete files inside their own top folder.
drop policy if exists "plans_read_own" on storage.objects;
create policy "plans_read_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "plans_insert_own" on storage.objects;
create policy "plans_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "plans_delete_own" on storage.objects;
create policy "plans_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);
