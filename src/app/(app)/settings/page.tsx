import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsForm from "./SettingsForm";
import type { CompanySettings } from "./actions";
import { resolveProfile } from "@/lib/proposal/profile";
import { resolveBranding } from "@/lib/branding";

export default async function SettingsPage() {
  const supabase = await createClient();

  // Resilient to migration 0016 not being run yet — the form still renders
  // (saving shows a friendly "run the migration" error).
  // select("*") so the page keeps working whatever columns exist (pre/post 0018).
  const { data } = await supabase
    .from("company_settings")
    .select("*")
    .maybeSingle();

  const initial: CompanySettings = {
    company_name: data?.company_name ?? null,
    company_address: data?.company_address ?? null,
    company_phone: data?.company_phone ?? null,
    company_email: data?.company_email ?? null,
    company_license: data?.company_license ?? "CA LIC #1033830",
    signer_name: data?.signer_name ?? null,
    signer_title: data?.signer_title ?? null,
    default_contingency_pct: data?.default_contingency_pct ?? 0,
    default_insurance_pct: data?.default_insurance_pct ?? 0,
    default_op_pct: data?.default_op_pct ?? 0,
  };
  const profile = resolveProfile(data?.proposal_profile);
  const profileWasSet = data?.proposal_profile != null;
  const branding = resolveBranding(data?.branding);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <PageHeader
          title="Settings"
          subtitle="Company identity for proposals, and the markup defaults every new estimate starts from."
        />
        <section className="mb-5 rounded-xl panel p-5">
          <h2 className="font-heading text-base text-foreground">Appearance</h2>
          <p className="mt-0.5 mb-3 text-sm text-muted">
            Dark is the default. This is remembered on this device only.
          </p>
          <ThemeToggle />
        </section>

        <SettingsForm initial={initial} profile={profile} profileWasSet={profileWasSet} branding={branding} />
      </div>
    </div>
  );
}
