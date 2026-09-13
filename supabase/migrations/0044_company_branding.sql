-- ============================================================================
-- XtraUnit Estimator — 0044: company branding
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Each company gets its own look: logo, brand colour, default theme, slogan,
-- tagline, the voice the AI writes in, and the kinds of jobs it takes. One
-- JSON block, so the welcome wizard and Settings can grow without more
-- columns. The logo is stored as a small data URL inside the block (resized
-- in the browser), so the client's proposal link shows it without any
-- storage permission.
--
-- Accounts that already have a company name are marked as onboarded, so the
-- welcome wizard only greets genuinely new accounts.
-- ============================================================================

alter table public.company_settings
  add column if not exists branding jsonb;

update public.company_settings
   set branding = jsonb_build_object('onboarded_at', now())
 where branding is null
   and company_name is not null;

comment on column public.company_settings.branding is
  'logo (data URL), primary (#hex), theme, slogan, tagline, voice, job_types[], onboarded_at. See src/lib/branding.ts.';
