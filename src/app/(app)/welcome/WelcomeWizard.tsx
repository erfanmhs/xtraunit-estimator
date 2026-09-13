"use client";

/**
 * Three steps, all skippable:
 *   1. Your company — name, license, contact, logo, brand colour, theme.
 *   2. How you talk about your work — slogan, tagline, voice, kinds of jobs,
 *      and three plain notes about the company.
 *   3. Your proposal language — the AI drafts the standard sections from
 *      the notes and the voice; the owner reads, edits, keeps.
 * "Skip for now" marks the account onboarded and goes to Projects; every
 * field here is also in Settings.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import BrandingSection from "@/components/BrandingSection";
import { type Branding } from "@/lib/branding";
import { type ProposalProfile } from "@/lib/proposal/profile";
import {
  draftProposalProfile,
  saveBranding,
  saveCompanySettings,
  saveProposalProfile,
  type CompanySettings,
} from "@/app/(app)/settings/actions";

type Identity = { [K in keyof CompanySettings]: CompanySettings[K] extends number ? number : string };

const FIELD =
  "w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand";
const LABEL = "text-[11px] uppercase tracking-wider text-muted";
const STEPS = ["Your company", "How you talk about your work", "Your proposal language"];

export default function WelcomeWizard({
  initialIdentity,
  initialBranding,
  initialProfile,
}: {
  initialIdentity: Identity;
  initialBranding: Branding;
  initialProfile: ProposalProfile;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<Identity>(initialIdentity);
  const [branding, setBranding] = useState<Branding>(initialBranding);
  const [notes, setNotes] = useState({ background: "", strengths: "", precon: "" });
  const [profile, setProfile] = useState<ProposalProfile>(initialProfile);
  const [drafted, setDrafted] = useState(false);
  const [slogans, setSlogans] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const idField = (k: keyof Identity, label: string, placeholder: string, type = "text") => (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <input
        type={type}
        value={String(identity[k] ?? "")}
        onChange={(e) => setIdentity((s) => ({ ...s, [k]: e.target.value }))}
        placeholder={placeholder}
        className={FIELD}
      />
    </label>
  );

  const toSettings = (): CompanySettings => ({
    company_name: identity.company_name.trim() || null,
    company_address: identity.company_address.trim() || null,
    company_phone: identity.company_phone.trim() || null,
    company_email: identity.company_email.trim() || null,
    company_license: identity.company_license.trim() || null,
    signer_name: identity.signer_name.trim() || null,
    signer_title: identity.signer_title.trim() || null,
    default_contingency_pct: Number(identity.default_contingency_pct) || 0,
    default_insurance_pct: Number(identity.default_insurance_pct) || 0,
    default_op_pct: Number(identity.default_op_pct) || 0,
  });

  function finish(skip: boolean) {
    setError(null);
    setBusy(skip ? "Skipping…" : "Saving…");
    start(async () => {
      const stamped: Branding = { ...branding, onboarded_at: new Date().toISOString() };
      if (!skip) {
        const a = await saveCompanySettings(toSettings());
        if (!a.ok) {
          setBusy(null);
          return setError(a.error ?? "Could not save the company details.");
        }
        if (drafted) {
          const p = await saveProposalProfile(profile);
          if (!p.ok) {
            setBusy(null);
            return setError(p.error ?? "Could not save the proposal language.");
          }
        }
      }
      const b = await saveBranding(stamped);
      setBusy(null);
      if (!b.ok) return setError(b.error ?? "Could not save.");
      router.push("/projects");
      router.refresh();
    });
  }

  function onDraft() {
    setError(null);
    setBusy("Writing…");
    start(async () => {
      const res = await draftProposalProfile({
        ...notes,
        company_name: identity.company_name,
        voice: branding.voice,
        job_types: branding.job_types,
        slogan: branding.slogan,
      });
      setBusy(null);
      if (!res.ok || !res.profile) return setError(res.error ?? "The AI could not draft it.");
      setProfile((p) => ({ ...res.profile!, terms: p.terms, standard_exclusions: p.standard_exclusions, references: p.references, compliance: p.compliance }));
      setSlogans(res.slogans ?? []);
      if (!branding.tagline && res.tagline) setBranding((b) => ({ ...b, tagline: res.tagline! }));
      setDrafted(true);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-brand-soft">Welcome</p>
            <h1 className="font-heading text-2xl text-foreground">Make it yours</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Three short steps: your logo and colour, how you talk about your work, and the words every proposal
              starts from. Everything here lives in Settings too.
            </p>
          </div>
          <button type="button" onClick={() => finish(true)} disabled={!!busy} className="text-sm text-muted hover:text-foreground disabled:opacity-50">
            Skip for now →
          </button>
        </div>

        {/* Steps */}
        <ol className="mt-6 flex gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 text-xs ${i === step ? "text-foreground" : "text-muted"}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${i <= step ? "bg-brand text-white" : "border border-border"}`}>
                {i + 1}
              </span>
              <span className="hidden sm:inline">{s}</span>
            </li>
          ))}
        </ol>

        <div className="glass mt-4 rounded-xl p-5">
          {step === 0 ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {idField("company_name", "Company name", "XtraUnit Construction")}
                {idField("company_license", "License", "CA LIC #1033830")}
                {idField("company_phone", "Phone", "(818) 000-0000", "tel")}
                {idField("company_email", "Email", "bids@company.com", "email")}
                <div className="sm:col-span-2">{idField("company_address", "Address", "Street, City, CA ZIP")}</div>
                {idField("signer_name", "Who signs proposals", "Erfan Mirza")}
                {idField("signer_title", "Their title", "Principal")}
              </div>
              <BrandingSection value={branding} onChange={setBranding} compact />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <p className="text-sm text-muted">
                A few plain notes. The AI turns them into the standard sections of your proposals in the next step.
              </p>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Who you are — how long, who founded it, what you&apos;re known for</span>
                <textarea value={notes.background} onChange={(e) => setNotes((n) => ({ ...n, background: e.target.value }))} rows={3} spellCheck className={FIELD} placeholder="Family-run design-build firm in Los Angeles since 2019; engineer and field superintendent as partners…" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>What sets you apart — the three things clients thank you for</span>
                <textarea value={notes.strengths} onChange={(e) => setNotes((n) => ({ ...n, strengths: e.target.value }))} rows={3} spellCheck className={FIELD} placeholder="We answer the phone; weekly photo reports; we price honestly and don't change-order the kitchen sink…" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>What happens after they say yes — your next steps</span>
                <textarea value={notes.precon} onChange={(e) => setNotes((n) => ({ ...n, precon: e.target.value }))} rows={2} spellCheck className={FIELD} placeholder="Walk the bid together, lock selections, pull permits, order long-lead items…" />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              {!drafted ? (
                <div className="rounded-lg border border-dashed border-border p-5 text-center">
                  <p className="text-sm text-foreground">Let the AI write your standard proposal sections from your notes, in the voice you chose.</p>
                  <p className="mt-1 text-xs text-muted">Who we are · why choose us · next steps · closing — and three slogan ideas. You read and edit before anything is saved. About a cent.</p>
                  <button type="button" onClick={onDraft} disabled={!!busy} className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50">
                    {busy === "Writing…" ? "Writing…" : "Write it with AI"}
                  </button>
                </div>
              ) : (
                <>
                  {slogans.length ? (
                    <div>
                      <span className={LABEL}>Slogan ideas — tap one to use it</span>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {slogans.map((s) => (
                          <button key={s} type="button" onClick={() => setBranding((b) => ({ ...b, slogan: s }))} className={`rounded-full border px-3 py-1 text-sm ${branding.slogan === s ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted hover:text-foreground"}`}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(["who_we_are", "next_steps", "closing"] as const).map((k) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className={LABEL}>{k === "who_we_are" ? "Who we are" : k === "next_steps" ? "Next steps" : "Closing line"}</span>
                      <textarea value={profile[k]} onChange={(e) => setProfile((p) => ({ ...p, [k]: e.target.value }))} rows={k === "who_we_are" ? 5 : 2} spellCheck className={FIELD} />
                    </label>
                  ))}
                  <div>
                    <span className={LABEL}>Why choose us</span>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      {profile.why_fit.map((b, i) => (
                        <div key={i} className="rounded-md border border-border p-2">
                          <input value={b.title} onChange={(e) => setProfile((p) => ({ ...p, why_fit: p.why_fit.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} className={`${FIELD} font-medium`} />
                          <textarea value={b.body} onChange={(e) => setProfile((p) => ({ ...p, why_fit: p.why_fit.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) }))} rows={2} className={`${FIELD} mt-1`} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={onDraft} disabled={!!busy} className="text-xs text-brand-soft hover:underline disabled:opacity-50">
                    Write it again
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-brand-soft">{error}</p> : null}

        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || !!busy} className="text-sm text-muted hover:text-foreground disabled:opacity-40">
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!!busy} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50">
              Next →
            </button>
          ) : (
            <button type="button" onClick={() => finish(false)} disabled={!!busy} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50">
              {busy === "Saving…" ? "Saving…" : "Finish and open Projects"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
