"use client";

/**
 * Company settings form: identity (used on proposals) + default markups
 * (every new project's Estimate starts with these). Saves as one row.
 */
import { useState, useTransition } from "react";
import {
  saveCompanySettings,
  saveProposalProfile,
  draftProposalProfile,
  type CompanySettings,
} from "./actions";
import { evalFormula } from "@/lib/formula";
import type { ProposalProfile } from "@/lib/proposal/profile";

const IDENTITY_FIELDS = [
  ["company_name", "Company name", "XtraUnit Construction"],
  ["company_address", "Address", "Street, City, CA ZIP"],
  ["company_phone", "Phone", "(818) 000-0000"],
  ["company_email", "Email", "bids@xtraunit.com"],
  ["company_license", "License", "CA LIC #1033830"],
  ["signer_name", "Proposal signer — name", "Erfan Mirza"],
  ["signer_title", "Proposal signer — title", "Principal"],
] as const;

const MARKUP_FIELDS = [
  ["default_contingency_pct", "Contingency"],
  ["default_insurance_pct", "Insurance"],
  ["default_op_pct", "Overhead & Profit"],
] as const;

export default function SettingsForm({
  initial,
  profile,
  profileWasSet,
}: {
  initial: CompanySettings;
  profile: ProposalProfile;
  profileWasSet: boolean;
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
        signer_name: identity.signer_name.trim() || null,
        signer_title: identity.signer_title.trim() || null,
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

      <p className="text-xs text-muted">
        Looking for $/SF benchmarks or standard unit prices? Those moved to the{" "}
        <span className="text-brand-soft">Cost Database</span> tab, with your
        price history.
      </p>

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

      <ProposalProfileSection initial={profile} wasSet={profileWasSet} />
    </div>
  );
}

// ── Proposal profile: the standard sections reused on every proposal ─────────

function ProposalProfileSection({
  initial,
  wasSet,
}: {
  initial: ProposalProfile;
  wasSet: boolean;
}) {
  const [p, setP] = useState<ProposalProfile>(initial);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // "Draft from a few notes" helper.
  const [showNotes, setShowNotes] = useState(!wasSet);
  const [notes, setNotes] = useState({ background: "", strengths: "", precon: "" });
  const [drafting, setDrafting] = useState(false);

  const setField = (k: keyof ProposalProfile, v: string) =>
    setP((s) => ({ ...s, [k]: v }));
  const setBullet = (i: number, f: "title" | "body", v: string) =>
    setP((s) => ({
      ...s,
      why_fit: s.why_fit.map((b, j) => (j === i ? { ...b, [f]: v } : b)),
    }));

  function onDraft() {
    setError(null);
    setDrafting(true);
    start(async () => {
      const res = await draftProposalProfile(notes);
      setDrafting(false);
      if (!res.ok || !res.profile) {
        setError(res.error ?? "Could not draft.");
        return;
      }
      setP(res.profile);
      setShowNotes(false);
    });
  }

  function onSave() {
    setState("idle");
    setError(null);
    start(async () => {
      const res = await saveProposalProfile(p);
      if (res.ok) setState("saved");
      else {
        setState("error");
        setError(res.error ?? "Could not save.");
      }
    });
  }

  return (
    <section className="glass rounded-xl p-5">
      <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
        Proposal profile
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        Your standard proposal sections — reused on every bid. The AI only writes
        the project-specific parts; these stay consistent. Set them once here.
      </p>

      {!wasSet ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          First time here — answer the few questions below and let the AI fill
          these in, or edit them directly. They&apos;re pre-filled with sensible
          starting text so your proposals look right immediately.
        </p>
      ) : null}

      {/* Draft-from-notes helper */}
      <div className="mt-3 rounded-lg border border-border p-3">
        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          className="text-xs text-brand-soft hover:underline"
        >
          {showNotes ? "▾" : "▸"} Draft these from a few notes (AI)
        </button>
        {showNotes ? (
          <div className="mt-3 space-y-2">
            {[
              ["background", "Who are you? Background, founders, what you build."],
              ["strengths", "What sets you apart? Your strengths."],
              ["precon", "What do you offer up front (preconstruction, next steps)?"],
            ].map(([k, ph]) => (
              <textarea
                key={k}
                value={notes[k as keyof typeof notes]}
                onChange={(e) =>
                  setNotes((s) => ({ ...s, [k]: e.target.value }))
                }
                placeholder={ph}
                rows={2}
                className="w-full rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
              />
            ))}
            <button
              type="button"
              onClick={onDraft}
              disabled={drafting}
              className="glass-brand rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
            >
              {drafting ? "Drafting…" : "Draft sections with AI"}
            </button>
          </div>
        ) : null}
      </div>

      {/* Editable sections */}
      <div className="mt-4 space-y-4">
        <ProfileField
          label="Who we are"
          value={p.who_we_are}
          onChange={(v) => setField("who_we_are", v)}
          rows={4}
        />

        <div>
          <span className="text-[11px] uppercase tracking-wider text-muted">
            Why we&apos;re the right fit (4 points)
          </span>
          <div className="mt-1.5 space-y-2">
            {p.why_fit.map((b, i) => (
              <div key={i} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                <input
                  type="text"
                  value={b.title}
                  onChange={(e) => setBullet(i, "title", e.target.value)}
                  placeholder="Title"
                  className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand sm:w-44"
                />
                <input
                  type="text"
                  value={b.body}
                  onChange={(e) => setBullet(i, "body", e.target.value)}
                  placeholder="One sentence"
                  className="flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
                />
              </div>
            ))}
          </div>
        </div>

        <ProfileField
          label="Next steps"
          value={p.next_steps}
          onChange={(v) => setField("next_steps", v)}
          rows={3}
        />
        <ProfileField
          label="License / bonding note"
          value={p.license_note}
          onChange={(v) => setField("license_note", v)}
          rows={2}
        />
        <ProfileField
          label="Finish package note"
          value={p.finish_note}
          onChange={(v) => setField("finish_note", v)}
          rows={2}
        />
        <ProfileField
          label="Closing line"
          value={p.closing}
          onChange={(v) => setField("closing", v)}
          rows={2}
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {state === "saved" ? (
          <span className="text-sm text-green-300">Saved ✓</span>
        ) : null}
        {error ? <span className="text-sm text-brand-soft">{error}</span> : null}
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="glass-brand rounded-lg px-5 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save proposal profile"}
        </button>
      </div>
    </section>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none focus:border-brand"
      />
    </label>
  );
}
