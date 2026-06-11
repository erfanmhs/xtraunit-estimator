"use client";

/**
 * Company settings form: identity (used on proposals) + default markups
 * (every new project's Estimate starts with these). Saves as one row.
 */
import { useState, useTransition } from "react";
import { saveCompanySettings, type CompanySettings } from "./actions";
import { evalFormula } from "@/lib/formula";

const IDENTITY_FIELDS = [
  ["company_name", "Company name", "XtraUnit Construction"],
  ["company_address", "Address", "Street, City, CA ZIP"],
  ["company_phone", "Phone", "(818) 000-0000"],
  ["company_email", "Email", "bids@xtraunit.com"],
  ["company_license", "License", "CA LIC #1033830"],
] as const;

const MARKUP_FIELDS = [
  ["default_contingency_pct", "Contingency"],
  ["default_insurance_pct", "Insurance"],
  ["default_op_pct", "Overhead & Profit"],
] as const;

export default function SettingsForm({
  initial,
}: {
  initial: CompanySettings;
}) {
  const [identity, setIdentity] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const [k] of IDENTITY_FIELDS) o[k] = initial[k] ?? "";
    return o;
  });
  const [pcts, setPcts] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const [k] of MARKUP_FIELDS) o[k] = String(initial[k] ?? 0);
    return o;
  });
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSave() {
    setState("idle");
    setError(null);
    const parsed: Record<string, number> = {};
    for (const [k, label] of MARKUP_FIELDS) {
      const v = evalFormula(pcts[k]) ?? (pcts[k].trim() === "" ? 0 : null);
      if (v == null || v < 0 || v > 100) {
        setState("error");
        setError(`${label} must be a percentage between 0 and 100.`);
        return;
      }
      parsed[k] = v;
    }
    startTransition(async () => {
      const res = await saveCompanySettings({
        company_name: identity.company_name.trim() || null,
        company_address: identity.company_address.trim() || null,
        company_phone: identity.company_phone.trim() || null,
        company_email: identity.company_email.trim() || null,
        company_license: identity.company_license.trim() || null,
        default_contingency_pct: parsed.default_contingency_pct,
        default_insurance_pct: parsed.default_insurance_pct,
        default_op_pct: parsed.default_op_pct,
      });
      if (res.ok) setState("saved");
      else {
        setState("error");
        setError(res.error ?? "Could not save.");
      }
    });
  }

  return (
    <div className="mt-6 max-w-2xl space-y-6">
      <section className="glass rounded-xl p-5">
        <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
          Company identity
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Used on proposals and the letterhead (Phase 11).
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {IDENTITY_FIELDS.map(([k, label, placeholder]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted">
                {label}
              </span>
              <input
                type="text"
                value={identity[k]}
                onChange={(e) =>
                  setIdentity((s) => ({ ...s, [k]: e.target.value }))
                }
                placeholder={placeholder}
                className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="glass rounded-xl p-5">
        <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
          Default markups
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Every new project&apos;s Estimate starts with these. You can still
          change them per project — that never touches these defaults.
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          {MARKUP_FIELDS.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted">
                {label}
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={pcts[k]}
                  onChange={(e) =>
                    setPcts((s) => ({ ...s, [k]: e.target.value }))
                  }
                  className="w-24 rounded-md border border-border bg-black/20 px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-brand"
                />
                <span className="text-sm text-muted">%</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {state === "saved" ? (
          <span className="text-sm text-green-300">Saved ✓</span>
        ) : null}
        {state === "error" && error ? (
          <span className="text-sm text-brand-soft">{error}</span>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="glass-brand rounded-lg px-5 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
