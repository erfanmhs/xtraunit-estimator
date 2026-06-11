"use server";

/**
 * Company settings: identity (proposal letterhead) + default markups
 * (pre-fill every new project's Estimate). One row per user, upserted.
 */
import { createClient } from "@/lib/supabase/server";

export type CompanySettings = {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_license: string | null;
  default_contingency_pct: number;
  default_insurance_pct: number;
  default_op_pct: number;
};

export async function saveCompanySettings(
  settings: CompanySettings,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  for (const k of [
    "default_contingency_pct",
    "default_insurance_pct",
    "default_op_pct",
  ] as const) {
    const v = settings[k];
    if (!Number.isFinite(v) || v < 0 || v > 100)
      return { ok: false, error: "Markups must be between 0 and 100 percent." };
  }

  const { error } = await supabase.from("company_settings").upsert(
    {
      owner_id: user.id,
      ...settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  if (error)
    return {
      ok: false,
      error:
        "Could not save settings. (Has migration 0016 been run in Supabase?)",
    };
  return { ok: true };
}
