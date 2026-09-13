import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveBranding } from "@/lib/branding";
import { resolveProfile } from "@/lib/proposal/profile";
import WelcomeWizard from "./WelcomeWizard";

/**
 * The first-time welcome: a three-step wizard that sets the company's look
 * and voice and lets the AI write the standard proposal language. Shown
 * once — the Projects page sends a new account here until the wizard is
 * finished or skipped; after that it is reachable from Settings only.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("company_settings").select("*").maybeSingle();
  const branding = resolveBranding(data?.branding);
  if (branding.onboarded_at) redirect("/projects");

  return (
    <WelcomeWizard
      initialIdentity={{
        company_name: data?.company_name ?? "",
        company_license: data?.company_license ?? "",
        company_phone: data?.company_phone ?? "",
        company_email: data?.company_email ?? user?.email ?? "",
        company_address: data?.company_address ?? "",
        signer_name: data?.signer_name ?? "",
        signer_title: data?.signer_title ?? "",
        default_contingency_pct: Number(data?.default_contingency_pct ?? 0),
        default_insurance_pct: Number(data?.default_insurance_pct ?? 0),
        default_op_pct: Number(data?.default_op_pct ?? 0),
      }}
      initialBranding={branding}
      initialProfile={resolveProfile(data?.proposal_profile)}
    />
  );
}
