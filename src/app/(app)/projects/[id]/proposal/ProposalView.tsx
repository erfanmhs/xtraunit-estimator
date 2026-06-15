"use client";

/**
 * The client-ready proposal. On screen: a white "paper" preview inside the
 * app. Print/Save as PDF prints ONLY the paper (print CSS in globals).
 * The letter is editable (AI drafts, you own it); the cost table, markups,
 * assumptions and exclusions are assembled live from the project data.
 */
import { useMemo, useState, useTransition } from "react";
import { saveProposal, draftLetter } from "./actions";
import { lineTotal, type PricedLine } from "../pricing/PricingTable";
import type { Markups } from "../estimate/actions";

export type CompanyInfo = {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_license: string | null;
  signer_name: string | null;
  signer_title: string | null;
};
export type ProposalRow = {
  letter_text: string | null;
  client_name: string | null;
  proposal_date: string | null;
};
export type FindingLite = { kind: string; text: string };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function hasPrice(li: PricedLine): boolean {
  return li.price_status === "proposed" || li.price_status === "confirmed";
}

const MARKUP_LABELS: [keyof Markups, string][] = [
  ["contingency_pct", "Contingency"],
  ["insurance_pct", "Insurance"],
  ["overhead_pct", "Overhead & Profit"],
];

export default function ProposalView({
  projectId,
  company,
  project,
  lines,
  markups,
  findings,
  initial,
}: {
  projectId: string;
  company: CompanyInfo;
  project: { name: string; client_name: string | null; address: string | null };
  lines: PricedLine[];
  markups: Markups;
  findings: FindingLite[];
  initial: ProposalRow;
}) {
  const [letter, setLetter] = useState(initial.letter_text ?? "");
  const [clientName, setClientName] = useState(
    initial.client_name ?? project.client_name ?? "",
  );
  const [proposalDate, setProposalDate] = useState(
    initial.proposal_date ?? new Date().toLocaleDateString("en-US"),
  );
  const [editing, setEditing] = useState(!initial.letter_text);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  // Live numbers
  const priced = lines.filter(hasPrice);
  const divisions = useMemo(() => {
    const out: { key: string; total: number }[] = [];
    for (const li of priced) {
      const key = `${li.division_code ?? "—"} · ${li.division_name ?? "Other"}`;
      let d = out.find((x) => x.key === key);
      if (!d) {
        d = { key, total: 0 };
        out.push(d);
      }
      d.total += lineTotal(li);
    }
    return out;
  }, [priced]);
  const subtotal = divisions.reduce((a, d) => a + d.total, 0);
  const steps = useMemo(() => {
    const out: { label: string; pct: number; amount: number }[] = [];
    let running = subtotal;
    for (const [k, label] of MARKUP_LABELS) {
      const pct = markups[k];
      const amount = running * (pct / 100);
      running += amount;
      out.push({ label, pct, amount });
    }
    return out;
  }, [subtotal, markups]);
  const grandTotal = subtotal + steps.reduce((a, s) => a + s.amount, 0);

  const assumptions = findings.filter((f) => f.kind === "assumption");
  const exclusions = findings.filter((f) => f.kind === "exclusion");
  const unconfirmed = priced.filter((li) => li.price_status === "proposed").length;
  const unpriced = lines.length - priced.length;

  function onDraft() {
    setError(null);
    setBusy("AI is drafting the letter…");
    startTransition(async () => {
      const summary = divisions.map((d) => d.key.split(" · ")[1]).join(", ");
      const res = await draftLetter(projectId, grandTotal, summary);
      setBusy(null);
      if (!res.ok || !res.letter) {
        setError(res.error ?? "Draft failed.");
        return;
      }
      setLetter(res.letter);
      setEditing(true);
    });
  }

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveProposal(projectId, {
        letter_text: letter.trim() || null,
        client_name: clientName.trim() || null,
        proposal_date: proposalDate.trim() || null,
      });
      if (!res.ok) setError(res.error ?? "Could not save.");
      else {
        setSaved(true);
        setEditing(false);
      }
    });
  }

  return (
    <div className="mt-6">
      {/* Controls (never printed) */}
      <div className="print-hide mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDraft}
          disabled={!!busy}
          className="glass-brand rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
        >
          {letter ? "Re-draft letter with AI" : "Draft letter with AI"}
        </button>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-foreground"
        >
          {editing ? "Preview letter" : "Edit letter"}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-foreground"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="glass-brand rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-brand/30"
        >
          Print / Save as PDF
        </button>
        {saved ? <span className="text-sm text-green-300">Saved ✓</span> : null}
        {busy ? (
          <span className="animate-pulse text-sm text-muted">{busy}</span>
        ) : null}
        {error ? <span className="text-sm text-brand-soft">{error}</span> : null}
      </div>

      {unconfirmed > 0 || unpriced > 0 ? (
        <p className="print-hide mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          Heads up before sending:{" "}
          {unconfirmed > 0 ? `${unconfirmed} prices are still unconfirmed. ` : ""}
          {unpriced > 0 ? `${unpriced} scope lines are unpriced and not in the number.` : ""}
        </p>
      ) : null}

      {/* The paper */}
      <div className="proposal-sheet mx-auto max-w-3xl rounded-md bg-white p-10 text-black shadow-2xl">
        {/* Letterhead */}
        <div className="border-b-2 border-[#A01C2D] pb-4">
          <p className="font-heading text-2xl font-bold tracking-wide text-[#A01C2D]">
            {company.company_name || "XtraUnit Construction"}
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            {[company.company_address, company.company_phone, company.company_email]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-xs text-neutral-600">
            {company.company_license || "CA LIC #1033830"} · Licensed &amp; Bonded
          </p>
        </div>

        {/* Addressing */}
        <div className="mt-6 flex items-start justify-between text-sm">
          <div>
            <p className="text-neutral-500">To:</p>
            {editing ? (
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client name"
                className="print-hide mt-0.5 rounded border border-neutral-300 px-2 py-1 text-sm"
              />
            ) : null}
            <p className={editing ? "print-only font-medium" : "font-medium"}>
              {clientName || "Owner"}
            </p>
            <p className="mt-2 text-neutral-500">RE:</p>
            <p className="font-medium">
              {project.name}
              {project.address ? ` — ${project.address}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-neutral-500">Date</p>
            {editing ? (
              <input
                value={proposalDate}
                onChange={(e) => setProposalDate(e.target.value)}
                className="print-hide mt-0.5 w-32 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
              />
            ) : null}
            <p className={editing ? "print-only font-medium" : "font-medium"}>
              {proposalDate}
            </p>
          </div>
        </div>

        {/* Letter */}
        <div className="mt-6">
          {editing ? (
            <textarea
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
              rows={10}
              placeholder='Write the cover letter, or click "Draft letter with AI".'
              className="print-hide w-full rounded border border-neutral-300 p-3 text-sm leading-relaxed"
            />
          ) : null}
          <div
            className={`${editing ? "print-only" : ""} whitespace-pre-line text-sm leading-relaxed`}
          >
            {letter || "—"}
          </div>
          {/* Signature block from Settings */}
          {company.signer_name ? (
            <div className="mt-4 text-sm leading-snug">
              <p className="font-medium">{company.signer_name}</p>
              {company.signer_title ? (
                <p className="text-neutral-600">{company.signer_title}</p>
              ) : null}
              <p className="text-neutral-600">
                {company.company_name || "XtraUnit Construction"}
              </p>
            </div>
          ) : null}
        </div>

        {/* Cost table */}
        <div className="mt-8">
          <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold uppercase tracking-wider">
            Cost Summary — CSI MasterFormat
          </h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {divisions.map((d) => (
                <tr key={d.key} className="border-b border-neutral-100">
                  <td className="py-1.5">{d.key.replace(" · ", " — ")}</td>
                  <td className="py-1.5 text-right">{usd.format(d.total)}</td>
                </tr>
              ))}
              <tr className="border-b border-neutral-300 font-medium">
                <td className="py-1.5">Direct cost subtotal</td>
                <td className="py-1.5 text-right">{usd.format(subtotal)}</td>
              </tr>
              {steps.map((s) =>
                s.pct > 0 ? (
                  <tr key={s.label} className="border-b border-neutral-100">
                    <td className="py-1.5">
                      {s.label} ({s.pct}%)
                    </td>
                    <td className="py-1.5 text-right">{usd.format(s.amount)}</td>
                  </tr>
                ) : null,
              )}
              <tr className="font-bold">
                <td className="py-2 text-base">TOTAL PROPOSAL AMOUNT</td>
                <td className="py-2 text-right text-base text-[#A01C2D]">
                  {usd.format(grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Assumptions & exclusions */}
        {assumptions.length > 0 ? (
          <div className="mt-6">
            <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold uppercase tracking-wider">
              Assumptions
            </h2>
            <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed">
              {assumptions.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {exclusions.length > 0 ? (
          <div className="mt-6">
            <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold uppercase tracking-wider">
              Exclusions
            </h2>
            <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed">
              {exclusions.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Acceptance */}
        <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
          <div>
            <p className="border-t border-neutral-400 pt-1 text-neutral-600">
              Owner / Authorized Agent — Signature &amp; Date
            </p>
          </div>
          <div>
            <p className="border-t border-neutral-400 pt-1 text-neutral-600">
              {company.company_name || "XtraUnit Construction"} — Signature &amp; Date
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
