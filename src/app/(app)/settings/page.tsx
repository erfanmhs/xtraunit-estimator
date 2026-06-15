import { createClient } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import type { CompanySettings } from "./actions";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <h1 className="font-heading text-2xl text-foreground">Settings</h1>
        <p className="text-sm text-muted">
          Company identity for proposals, and the markup defaults every new
          estimate starts from.
        </p>
        <SettingsForm initial={initial} />
      </div>
    </div>
  );
}
