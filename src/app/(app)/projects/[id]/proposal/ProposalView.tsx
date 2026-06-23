"use client";

/**
 * The client-ready proposal — XtraUnit's full format on a white "paper" sheet.
 * Print/Save as PDF prints only the paper (print CSS in globals).
 *
 * Project-specific narrative (opening, project description, "Our Understanding")
 * is AI-drafted and editable. The standard sections (Who We Are, Why We're the
 * Right Fit, Next Steps, license/finish notes, closing) come from the company
 * Proposal profile (Settings). The Bid Summary, scope table and cost waterfall
 * are assembled live from the project's scope/pricing/estimate data.
 */
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { saveProposal, draftProposalNarrative } from "./actions";
import { lineTotal, type PricedLine } from "../pricing/PricingTable";
import type { Markups } from "../estimate/actions";
import type { ProposalProfile } from "@/lib/proposal/profile";

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
  project_description: string | null;
  understanding: string | null;
  estimated_duration: string | null;
  anticipated_start: string | null;
  table_style: string | null;
};
export type FindingLite = { kind: string; text: string };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function isExcluded(li: PricedLine): boolean {
  return li.status === "excluded";
}
function hasPrice(li: PricedLine): boolean {
  return li.price_status === "proposed" || li.price_status === "confirmed";
}

const MARKUP_LABELS: [keyof Markups, string][] = [
  ["contingency_pct", "Contingency"],
  ["insurance_pct", "Insurance"],
  ["overhead_pct", "Profit & Overhead"],
];

type DivGroup = { code: string | null; name: string; total: number; rows: PricedLine[] };

function groupByDivision(lines: PricedLine[]): DivGroup[] {
  const out: DivGroup[] = [];
  for (const li of lines) {
    const code = li.division_code ?? null;
    const name = li.division_name ?? "Other";
    let g = out.find((x) => x.code === code && x.name === name);
    if (!g) {
      g = { code, name, total: 0, rows: [] };
      out.push(g);
    }
    g.rows.push(li);
    g.total += lineTotal(li);
  }
  return out;
}

export default function ProposalView({
  projectId,
  company,
  profile,
  project,
  lines,
  markups,
  findings,
  initial,
}: {
  projectId: string;
  company: CompanyInfo;
  profile: ProposalProfile;
  project: {
    name: string;
    client_name: string | null;
    address: string | null;
    project_type: string | null;
    building_sf: number | null;
  };
  lines: PricedLine[];
  markups: Markups;
  findings: FindingLite[];
  initial: ProposalRow;
}) {
  const [opening, setOpening] = useState(initial.letter_text ?? "");
  const [description, setDescription] = useState(initial.project_description ?? "");
  const [understanding, setUnderstanding] = useState(initial.understanding ?? "");
  const [clientName, setClientName] = useState(
    initial.client_name ?? project.client_name ?? "",
  );
  const [proposalDate, setProposalDate] = useState(
    initial.proposal_date ?? new Date().toLocaleDateString("en-US"),
  );
  const [duration, setDuration] = useState(initial.estimated_duration ?? "");
  const [start, setStart] = useState(initial.anticipated_start ?? "");
  const [tableStyle, setTableStyle] = useState<"priced" | "status">(
    initial.table_style === "status" ? "status" : "priced",
  );
  const [editing, setEditing] = useState(!initial.letter_text);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  // Live numbers — totals only count active (non-excluded), priced lines.
  const active = lines.filter((li) => !isExcluded(li));
  const priced = active.filter(hasPrice);
  const pricedDivisions = useMemo(() => groupByDivision(priced), [priced]);
  const scopeDivisions = useMemo(() => groupByDivision(lines), [lines]);
  const subtotal = pricedDivisions.reduce((a, d) => a + d.total, 0);
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
  const sf = project.building_sf;
  const psf = sf && sf > 0 ? grandTotal / sf : null;

  const assumptions = findings.filter((f) => f.kind === "assumption");
  const exclusions = findings.filter((f) => f.kind === "exclusion");
  // Scope lines you marked "Exclude" — kept (not deleted), shown here as
  // exclusions on the proposal regardless of the scope-table style.
  const excludedScope = lines.filter(isExcluded);
  const unconfirmed = priced.filter((li) => li.price_status === "proposed").length;
  const unpriced = active.length - priced.length;

  function onDraft() {
    setError(null);
    setBusy("AI is drafting the letter…");
    startTransition(async () => {
      const summary = pricedDivisions.map((d) => d.name).join(", ");
      const res = await draftProposalNarrative(projectId, grandTotal, summary);
      setBusy(null);
      if (!res.ok || !res.narrative) {
        setError(res.error ?? "Draft failed.");
        return;
      }
      setOpening(res.narrative.opening);
      setDescription(res.narrative.project_description);
      setUnderstanding(res.narrative.understanding);
      setEditing(true);
    });
  }

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveProposal(projectId, {
        letter_text: opening.trim() || null,
        project_description: description.trim() || null,
        understanding: understanding.trim() || null,
        client_name: clientName.trim() || null,
        proposal_date: proposalDate.trim() || null,
        estimated_duration: duration.trim() || null,
        anticipated_start: start.trim() || null,
        table_style: tableStyle,
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
          {opening ? "Re-draft letter with AI" : "Draft letter with AI"}
        </button>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-foreground"
        >
          {editing ? "Preview" : "Edit"}
        </button>
        {/* Table style toggle */}
        <div className="inline-flex overflow-hidden rounded-md border border-border text-sm">
          <button
            type="button"
            onClick={() => setTableStyle("priced")}
            className={`px-3 py-2 transition-colors ${
              tableStyle === "priced"
                ? "bg-brand/30 text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            Priced table
          </button>
          <button
            type="button"
            onClick={() => setTableStyle("status")}
            className={`px-3 py-2 transition-colors ${
              tableStyle === "status"
                ? "bg-brand/30 text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            Included / Excluded
          </button>
        </div>
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

      {/* When editing: the Bid Summary inputs that aren't elsewhere */}
      {editing ? (
        <div className="print-hide mb-4 flex flex-wrap gap-3 rounded-lg border border-border p-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-wider text-muted">
              Estimated duration
            </span>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="18-21 months"
              className="rounded border border-border bg-black/20 px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="uppercase tracking-wider text-muted">
              Anticipated start
            </span>
            <input
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="Q2 2026"
              className="rounded border border-border bg-black/20 px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
            />
          </label>
        </div>
      ) : null}

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
            <p className="mt-2 text-neutral-500">RE: Bid Proposal</p>
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

        {/* Opening + project description */}
        <div className="mt-6 space-y-3 text-sm leading-relaxed">
          <EditableBlock
            editing={editing}
            value={opening}
            onChange={setOpening}
            rows={4}
            placeholder='Opening paragraph, or click "Draft letter with AI".'
          />
          <EditableBlock
            editing={editing}
            value={description}
            onChange={setDescription}
            rows={2}
            placeholder="Project description — what's being built."
          />
        </div>

        {/* Project Bid Summary */}
        <div className="mt-6 rounded-md border border-neutral-300 bg-neutral-50 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#A01C2D]">
            Project Bid Summary
          </h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <SummaryRow label="Total Bid Amount" value={usd.format(grandTotal)} strong />
            {sf ? (
              <SummaryRow label="Building Size" value={`${sf.toLocaleString()} SF`} />
            ) : null}
            {psf != null ? (
              <SummaryRow label="Cost Per SQFT" value={`$${Math.round(psf)}`} />
            ) : null}
            {duration ? (
              <SummaryRow label="Estimated Duration" value={duration} />
            ) : null}
            {start ? <SummaryRow label="Anticipated Start" value={start} /> : null}
            {project.project_type ? (
              <SummaryRow label="Project Type" value={project.project_type} />
            ) : null}
          </dl>
        </div>

        {/* Our Understanding */}
        {(understanding || editing) && (
          <Section title="Our Understanding of the Project">
            <EditableBlock
              editing={editing}
              value={understanding}
              onChange={setUnderstanding}
              rows={5}
              placeholder="What you understand about the site, plans reviewed, agencies…"
            />
          </Section>
        )}

        {/* Assumptions */}
        {assumptions.length > 0 ? (
          <Section title="Assumptions">
            <ul className="list-disc pl-5">
              {assumptions.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* Exclusions: excluded scope lines + exclusion findings + license note */}
        {exclusions.length > 0 || excludedScope.length > 0 ? (
          <Section title="Exclusions">
            <ul className="list-disc pl-5">
              {excludedScope.map((li) => (
                <li key={li.id}>{li.description}</li>
              ))}
              {exclusions.map((f, i) => (
                <li key={`f-${i}`}>{f.text}</li>
              ))}
            </ul>
            {profile.license_note ? (
              <p className="mt-2 text-neutral-700">{profile.license_note}</p>
            ) : null}
          </Section>
        ) : null}

        {/* Finish package note */}
        {profile.finish_note ? (
          <Section title="Finish Materials & Fixtures">
            <p>{profile.finish_note}</p>
          </Section>
        ) : null}

        {/* Who We Are */}
        <Section title="Who We Are">
          <p>{profile.who_we_are}</p>
        </Section>

        {/* Why We're the Right Fit */}
        <Section title="Why We're the Right Fit">
          <ul className="space-y-1">
            {profile.why_fit.map((b, i) => (
              <li key={i}>
                <span className="font-semibold">{b.title}:</span> {b.body}
              </li>
            ))}
          </ul>
        </Section>

        {/* Next Steps */}
        <Section title="Next Steps">
          <p>{profile.next_steps}</p>
          {profile.closing ? (
            <p className="mt-2">{profile.closing}</p>
          ) : null}
        </Section>

        {/* Signature block */}
        {company.signer_name ? (
          <div className="mt-6 text-sm leading-snug">
            <p>Respectfully,</p>
            <p className="mt-3 font-medium">{company.signer_name}</p>
            {company.signer_title ? (
              <p className="text-neutral-600">{company.signer_title}</p>
            ) : null}
            <p className="text-neutral-600">
              {company.company_name || "XtraUnit Construction"}
            </p>
          </div>
        ) : null}

        {/* Scope of Work table */}
        <div className="mt-8">
          <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold uppercase tracking-wider">
            Scope of Work — CSI MasterFormat
          </h2>
          {tableStyle === "priced" ? (
            <PricedTable divisions={pricedDivisions} />
          ) : (
            <StatusTable divisions={scopeDivisions} />
          )}
        </div>

        {/* Cost waterfall */}
        <div className="mt-6">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-neutral-200 font-medium">
                <td className="py-1.5">Builder&apos;s Cost</td>
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
              <tr className="border-t border-neutral-400 font-bold">
                <td className="py-2 text-base">Total Project Cost</td>
                <td className="py-2 text-right text-base text-[#A01C2D]">
                  {usd.format(grandTotal)}
                </td>
              </tr>
              {psf != null ? (
                <tr>
                  <td className="py-1 text-neutral-600">Cost per SQFT</td>
                  <td className="py-1 text-right text-neutral-600">
                    ${Math.round(psf)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

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

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-600">{label}</dt>
      <dd className={strong ? "font-bold text-[#A01C2D]" : "font-medium"}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 text-sm leading-relaxed">
      <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold uppercase tracking-wider">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function EditableBlock({
  editing,
  value,
  onChange,
  rows,
  placeholder,
}: {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder: string;
}) {
  return (
    <>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="print-hide w-full rounded border border-neutral-300 p-2 text-sm leading-relaxed"
        />
      ) : null}
      <p className={`${editing ? "print-only" : ""} whitespace-pre-line`}>
        {value || (editing ? "" : "—")}
      </p>
    </>
  );
}

function noteOf(li: PricedLine): string {
  return li.price_note ?? "";
}

function PricedTable({ divisions }: { divisions: DivGroup[] }) {
  if (!divisions.length)
    return <p className="mt-2 text-sm text-neutral-500">No priced scope yet.</p>;
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="border-b border-neutral-300 text-left text-[10px] uppercase tracking-wider text-neutral-500">
          <th className="py-1">Scope of Work</th>
          <th className="py-1">Note</th>
          <th className="py-1 text-right">Builder&apos;s Cost</th>
        </tr>
      </thead>
      <tbody>
        {divisions.map((d) => (
          <DivisionBlock key={`${d.code}-${d.name}`} d={d} mode="priced" />
        ))}
      </tbody>
    </table>
  );
}

function StatusTable({ divisions }: { divisions: DivGroup[] }) {
  if (!divisions.length)
    return <p className="mt-2 text-sm text-neutral-500">No scope yet.</p>;
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="border-b border-neutral-300 text-left text-[10px] uppercase tracking-wider text-neutral-500">
          <th className="py-1">Scope of Work</th>
          <th className="py-1">Note</th>
          <th className="py-1 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {divisions.map((d) => (
          <DivisionBlock key={`${d.code}-${d.name}`} d={d} mode="status" />
        ))}
      </tbody>
    </table>
  );
}

function DivisionBlock({ d, mode }: { d: DivGroup; mode: "priced" | "status" }) {
  return (
    <>
      <tr className="border-b border-neutral-200 bg-neutral-50">
        <td className="py-1.5 font-semibold" colSpan={2}>
          {d.code ? `Division ${d.code} — ` : ""}
          {d.name}
        </td>
        <td className="py-1.5 text-right font-semibold">
          {mode === "priced" ? usd.format(d.total) : ""}
        </td>
      </tr>
      {d.rows.map((li) => (
        <tr key={li.id} className="border-b border-neutral-100 align-top">
          <td className="py-1 pr-2">{li.description}</td>
          <td className="py-1 pr-2 text-neutral-500">{noteOf(li)}</td>
          <td className="py-1 text-right">
            {mode === "priced" ? (
              usd.format(lineTotal(li))
            ) : li.status === "excluded" ? (
              <span className="text-neutral-500">Excluded</span>
            ) : (
              <span className="text-neutral-700">Included</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
