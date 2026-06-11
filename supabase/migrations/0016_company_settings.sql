-- ============================================================================
-- XtraUnit Estimator — Company settings
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- One row per user: the company identity (used on proposals/letterhead in
-- Phase 11) and the DEFAULT markup percentages. Every new project's Estimate
-- starts pre-filled with these defaults; per-project overrides still apply.
-- ============================================================================

create table if not exists public.company_settings (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null unique references auth.users (id) on delete cascade,

  -- Identity (feeds the Phase 11 proposal letterhead)
  company_name             text,
  company_address          text,
  company_phone            text,
  company_email            text,
  company_license          text,   -- e.g. 'CA LIC #1033830'

  -- Default markups (the Estimate page's starting values for new projects)
  default_contingency_pct  numeric not null default 0,
  default_insurance_pct    numeric not null default 0,
  default_op_pct           numeric not null default 0,   -- Overhead & Profit, one line

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.company_settings enable row level security;

drop policy if exists "company_settings_select_own" on public.company_settings;
create policy "company_settings_select_own"
  on public.company_settings for select using (auth.uid() = owner_id);
drop policy if exists "company_settings_insert_own" on public.company_settings;
create policy "company_settings_insert_own"
  on public.company_settings for insert with check (auth.uid() = owner_id);
drop policy if exists "company_settings_update_own" on public.company_settings;
create policy "company_settings_update_own"
  on public.company_settings for update using (auth.uid() = owner_id);
drop policy if exists "company_settings_delete_own" on public.company_settings;
create policy "company_settings_delete_own"
  on public.company_settings for delete using (auth.uid() = owner_id);
