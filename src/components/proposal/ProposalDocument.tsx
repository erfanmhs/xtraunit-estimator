"use client";

/**
 * The proposal itself — one renderer for both audiences:
 *   mode "preview"  the owner's in-app view (live data, edits shown as typed)
 *   mode "public"   the client's share link (the frozen published snapshot)
 *
 * A web page first: opens on any device, section links at the top, a sticky
 * total that updates as the client toggles options, and an accept-in-document
 * form at the end (typed name = the e-sign stub). Print / Save as PDF is the
 * fallback — print CSS in globals.css prints only the `.proposal-sheet`.
 *
 * Section order follows what wins bids: executive summary → scope (with an
 * explicit "excluded / by others" list) → pricing (breakdown + tiered options)
 * → timeline (with the dependencies on the critical path) → terms → who we
 * are + references → accept.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  defaultSelection,
  formatDate,
  selectionTotal,
  tierSelection,
  tierTotals,
  type ProposalDoc,
} from "@/lib/proposal/model";
import { TERM_LABELS, type ProposalTerms } from "@/lib/proposal/profile";
import ContractTerms from "./ContractTerms";

// The default letterhead colour; a company's own brand colour replaces it
// through the --brand custom property set on the document root below.
const BRAND = "var(--brand)";
const BRAND_DEFAULT = "#A01C2D";
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type AcceptedInfo = { name: string; at: string } | null;

const NAV = [
  ["summary", "Summary"],
  ["scope", "Scope"],
  ["pricing", "Pricing"],
  ["timeline", "Timeline"],
  ["terms", "Terms"],
  ["contract", "Contract"],
  ["about", "About us"],
  ["accept", "Accept"],
] as const;

export default function ProposalDocument({
  doc,
  mode,
  accepted,
  onAccept,
}: {
  doc: ProposalDoc;
  mode: "preview" | "public";
  accepted: AcceptedInfo;
  onAccept?: (input: {
    name: string;
    email: string;
    selection: string[];
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(doc));
  const total = selectionTotal(doc, selected);
  const tiers = useMemo(() => tierTotals(doc), [doc]);
  const hasOptions = doc.pricing.options.length > 0;
  const expired =
    !!doc.valid_until && new Date(`${doc.valid_until}T23:59:59`) < new Date();
  const companyName = doc.company.company_name || "XtraUnit Construction";
  const brandColor = doc.company.branding?.primary || BRAND_DEFAULT;
  const logo = doc.company.branding?.logo ?? null;
  const slogan = doc.company.branding?.slogan ?? "";

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const activeTier: "base" | "recommended" | "enhanced" | null = useMemo(() => {
    for (const t of ["base", "recommended", "enhanced"] as const) {
      const ts = tierSelection(doc, t);
      if (ts.size === selected.size && [...ts].every((id) => selected.has(id))) return t;
    }
    return null;
  }, [doc, selected]);

  return (
    <div
      className="proposal-sheet mx-auto w-full max-w-4xl bg-white text-neutral-900 shadow-2xl sm:rounded-lg"
      style={{ "--brand": brandColor } as React.CSSProperties}
    >
      {/* Section links (screen only) */}
      <nav className="print-hide sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-6">
        <span className="mr-2 hidden shrink-0 text-xs font-bold uppercase tracking-widest sm:inline" style={{ color: BRAND }}>
          {companyName}
        </span>
        {NAV.filter(([id]) => id !== "contract" || doc.contract?.home_improvement).map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="shrink-0 rounded-full px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            {label}
          </a>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:border-neutral-500"
        >
          Print / PDF
        </button>
      </nav>

      <div className="px-5 py-8 sm:px-10 sm:py-10">
        {/* Letterhead + header */}
        <header className="border-b-2 pb-5" style={{ borderColor: BRAND }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={companyName} className="mb-2 h-14 w-auto max-w-[220px] object-contain" />
              ) : null}
              <p className="font-heading text-2xl font-bold tracking-wide" style={{ color: BRAND }}>
                {companyName}
              </p>
              {slogan ? <p className="text-sm italic text-neutral-600">{slogan}</p> : null}
              <p className="mt-1 text-xs text-neutral-600">
                {[doc.company.company_address, doc.company.company_phone, doc.company.company_email]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-xs text-neutral-600">
                {doc.company.company_license || "CA LIC #1033830"} · Licensed &amp; Bonded
              </p>
            </div>
            <div className="text-sm sm:text-right">
              <p className="text-neutral-500">Proposal date</p>
              <p className="font-medium">{doc.proposal_date}</p>
              {doc.valid_until ? (
                <p className={`mt-1 text-xs ${expired ? "text-red-700" : "text-neutral-600"}`}>
                  {expired ? "Pricing expired " : "Pricing valid through "}
                  <span className="font-medium">{formatDate(doc.valid_until)}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-widest text-neutral-500">Proposal for</p>
            <h1 className="font-heading mt-1 text-2xl font-semibold sm:text-3xl">{doc.project.name}</h1>
            <p className="text-sm text-neutral-600">
              {[doc.project.address, doc.project.project_type].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 text-sm">
              Prepared for <span className="font-medium">{doc.client_name}</span>
            </p>
          </div>

          {accepted ? (
            <p className="mt-4 inline-block rounded-md border border-green-600/40 bg-green-50 px-3 py-1.5 text-sm text-green-800">
              ✓ Accepted by {accepted.name} on {formatDate(accepted.at)}
            </p>
          ) : null}
        </header>

        {/* 01 Executive summary */}
        <Section id="summary" n="01" title="Executive summary">
          <Prose text={doc.executive_summary} placeholder="The executive summary goes here — name the client's own goal or constraint, our approach, and why it fits this job. Draft it with the AI or write it in the editor." mode={mode} />
          {doc.project_description ? (
            <p className="mt-4 rounded-md bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              <span className="font-medium text-neutral-900">The project: </span>
              {doc.project_description}
            </p>
          ) : null}
          {doc.understanding ? <Prose text={doc.understanding} mode={mode} className="mt-4" /> : null}
        </Section>

        {/* 02 Scope of work */}
        <Section id="scope" n="02" title="Scope of work">
          <p className="text-sm text-neutral-600">
            Organized by trade, the way the work is bought and built. Everything listed is included in the
            price; anything not listed, or listed under &ldquo;Excluded / by others,&rdquo; is outside this
            proposal.
          </p>
          <div className="mt-4 space-y-4">
            {doc.scope.divisions.map((d) => (
              <div key={`${d.code}-${d.name}`}>
                <h3 className="flex items-baseline justify-between gap-3 border-b border-neutral-200 pb-1 text-sm font-semibold">
                  <span>
                    {d.code ? <span className="mr-2 text-neutral-400">{d.code}</span> : null}
                    {d.name}
                  </span>
                </h3>
                <ul className="mt-1.5 space-y-1.5 text-sm">
                  {d.rows.map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span>{r.description}</span>
                        {r.detail ? (
                          <span className="block text-xs text-neutral-500">{r.detail}</span>
                        ) : null}
                      </span>
                      {r.quantity != null ? (
                        <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
                          {r.quantity.toLocaleString()} {r.unit ?? ""}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!doc.scope.divisions.length ? (
              <p className="text-sm text-neutral-500">No scope lines yet.</p>
            ) : null}
          </div>

          {doc.scope.assumptions.length ? (
            <SubSection title="Assumptions this price relies on">
              <Bullets items={doc.scope.assumptions} />
            </SubSection>
          ) : null}

          <SubSection title="Excluded / by others">
            <Bullets items={[...doc.scope.excluded, ...doc.profile.standard_exclusions]} />
            {doc.profile.license_note ? (
              <p className="mt-2 text-sm text-neutral-600">{doc.profile.license_note}</p>
            ) : null}
          </SubSection>

          {doc.profile.finish_note ? (
            <SubSection title="Finish materials & fixtures">
              <p className="text-sm">{doc.profile.finish_note}</p>
            </SubSection>
          ) : null}
        </Section>

        {/* 03 Pricing */}
        <Section id="pricing" n="03" title="Pricing">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs uppercase tracking-widest text-neutral-500">
                {hasOptions ? "Base bid" : "Total bid"}
              </p>
              <p className="font-heading mt-1 text-3xl font-semibold" style={{ color: BRAND }}>
                {usd.format(doc.pricing.total)}
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                {doc.project.building_sf
                  ? `${doc.project.building_sf.toLocaleString()} SF · $${Math.round(doc.pricing.psf ?? 0)}/SF · `
                  : ""}
                {doc.valid_until ? `valid through ${formatDate(doc.valid_until)}` : "fixed price"}
              </p>
            </div>
            <div className="text-sm">
              <p className="text-xs uppercase tracking-widest text-neutral-500">Where the money goes</p>
              <Breakdown doc={doc} />
            </div>
          </div>

          {/* By trade */}
          <SubSection title="By trade">
            <table className="w-full text-sm">
              <tbody>
                {doc.scope.divisions
                  .filter((d) => d.total > 0)
                  .map((d) => (
                    <tr key={`${d.code}-${d.name}`} className="border-b border-neutral-100">
                      <td className="py-1.5 pr-3">
                        {d.code ? <span className="mr-2 text-neutral-400">{d.code}</span> : null}
                        {d.name}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{usd.format(d.total)}</td>
                    </tr>
                  ))}
                <tr className="border-b border-neutral-200 font-medium">
                  <td className="py-1.5 pr-3">Direct cost</td>
                  <td className="py-1.5 text-right tabular-nums">{usd.format(doc.pricing.direct)}</td>
                </tr>
                {doc.pricing.steps
                  .filter((s) => s.pct > 0)
                  .map((s) => (
                    <tr key={s.label} className="border-b border-neutral-100 text-neutral-700">
                      <td className="py-1.5 pr-3">
                        {s.label} ({s.pct}%)
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{usd.format(s.amount)}</td>
                    </tr>
                  ))}
                <tr className="font-bold">
                  <td className="py-2 pr-3">{hasOptions ? "Base bid" : "Total"}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: BRAND }}>
                    {usd.format(doc.pricing.total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </SubSection>

          {/* Tiered options — interactive */}
          {hasOptions ? (
            <SubSection title="Options">
              <p className="text-sm text-neutral-600">
                Pick a package, or switch individual options on and off — the total updates as you go.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["base", "Base", tiers.base, true],
                    ["recommended", "Recommended", tiers.recommended, tiers.hasRecommended],
                    ["enhanced", "Enhanced", tiers.enhanced, tiers.hasEnhanced],
                  ] as const
                )
                  .filter(([, , , show]) => show)
                  .map(([key, label, amount]) => {
                    const on = activeTier === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelected(tierSelection(doc, key))}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          on ? "border-[#A01C2D] bg-[#A01C2D]/5" : "border-neutral-200 hover:border-neutral-400"
                        }`}
                        aria-pressed={on}
                      >
                        <p className="text-xs uppercase tracking-widest text-neutral-500">{label}</p>
                        <p className="font-heading mt-0.5 text-lg font-semibold">{usd.format(amount)}</p>
                        <p className="text-[11px] text-neutral-500">
                          {key === "base"
                            ? "As scoped above"
                            : key === "recommended"
                              ? "Base + recommended options"
                              : "Everything"}
                        </p>
                      </button>
                    );
                  })}
              </div>
              <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {doc.pricing.options.map((o) => {
                  const on = selected.has(o.id);
                  return (
                    <li key={o.id}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(o.id)}
                          className="mt-1 h-4 w-4 accent-[#A01C2D]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium">
                              {o.title}
                              <span className="ml-2 rounded-full border border-neutral-200 px-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
                                {o.tier}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm tabular-nums">+{usd.format(o.amount)}</span>
                          </span>
                          {o.description ? (
                            <span className="mt-0.5 block text-xs text-neutral-600">{o.description}</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 flex items-baseline justify-between rounded-md bg-neutral-50 px-4 py-2 text-sm">
                <span className="font-medium">Your total with the selected options</span>
                <span className="font-heading text-xl font-semibold tabular-nums" style={{ color: BRAND }}>
                  {usd.format(total)}
                </span>
              </p>
            </SubSection>
          ) : null}

          {mode === "preview" && doc.pricing.unpriced > 0 ? (
            <p className="print-hide mt-3 rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {doc.pricing.unpriced} scope line{doc.pricing.unpriced > 1 ? "s are" : " is"} unpriced and not in this number
              (only you see this note).
            </p>
          ) : null}
        </Section>

        {/* 04 Timeline */}
        <Section id="timeline" n="04" title="Timeline">
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact label="Anticipated start" value={doc.timeline.start || "To be set"} />
            <Fact label="Duration" value={doc.timeline.duration || "To be set"} />
          </div>
          {doc.timeline.milestones.length ? (
            <ol className="mt-4 space-y-2 border-l-2 border-neutral-200 pl-4">
              {doc.timeline.milestones.map((m, i) => (
                <li key={i} className="relative text-sm">
                  <span
                    className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full"
                    style={{ background: BRAND }}
                  />
                  <span className="font-medium">{m.label}</span>
                  {m.when ? <span className="text-neutral-600"> — {m.when}</span> : null}
                  {m.depends_on ? (
                    <span className="block text-xs text-neutral-500">Depends on: {m.depends_on}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-neutral-500">Milestones will be set at contract.</p>
          )}
          <SubSection title="Dependencies & assumptions on the critical path">
            {doc.timeline.assumptions.length ? (
              <Bullets items={doc.timeline.assumptions} />
            ) : (
              <p className="text-sm text-neutral-600">{doc.profile.terms.schedule}</p>
            )}
          </SubSection>
        </Section>

        {/* 05 Terms */}
        <Section id="terms" n="05" title="Terms & conditions">
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(TERM_LABELS) as (keyof ProposalTerms)[]).map((k) => (
              <div key={k}>
                <h3 className="text-sm font-semibold">{TERM_LABELS[k]}</h3>
                <p className="mt-0.5 text-sm text-neutral-700">{doc.profile.terms[k]}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* 06 The California home improvement contract block — only for owner-occupied residential work */}
        {doc.contract?.home_improvement ? (
          <Section id="contract" n="06" title="Home improvement contract">
            <ContractTerms doc={doc} contractPrice={total} />
          </Section>
        ) : null}

        {/* 07 About + references */}
        <Section id="about" n={doc.contract?.home_improvement ? "07" : "06"} title={`About ${companyName}`}>
          <p className="text-sm text-neutral-700">{doc.profile.who_we_are}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {doc.profile.why_fit.map((b, i) => (
              <li key={i} className="rounded-md border border-neutral-200 p-3 text-sm">
                <span className="font-semibold">{b.title}</span>
                <span className="block text-neutral-700">{b.body}</span>
              </li>
            ))}
          </ul>
          {doc.profile.references.length ? (
            <SubSection title="Recent work">
              <div className="grid gap-3 sm:grid-cols-2">
                {doc.profile.references.map((r, i) => (
                  <article key={i} className="overflow-hidden rounded-lg border border-neutral-200">
                    {r.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photo_url} alt={r.title} className="h-40 w-full object-cover" />
                    ) : null}
                    <div className="p-3 text-sm">
                      <p className="font-semibold">{r.title}</p>
                      {r.type_scale ? <p className="text-xs text-neutral-500">{r.type_scale}</p> : null}
                      {r.challenge ? (
                        <p className="mt-1.5 text-neutral-700">
                          <span className="font-medium">The challenge: </span>
                          {r.challenge}
                        </p>
                      ) : null}
                      {r.delivered ? (
                        <p className="mt-1 text-neutral-700">
                          <span className="font-medium">What we delivered: </span>
                          {r.delivered}
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </SubSection>
          ) : null}
        </Section>

        {/* 08 Accept */}
        <Section id="accept" n={doc.contract?.home_improvement ? "08" : "07"} title="Accept this proposal">
          <AcceptBlock
            doc={doc}
            mode={mode}
            accepted={accepted}
            expired={expired}
            selected={selected}
            total={total}
            onAccept={onAccept}
          />
          <p className="mt-6 text-sm text-neutral-700">{doc.profile.next_steps}</p>
          {doc.profile.closing ? <p className="mt-2 text-sm text-neutral-700">{doc.profile.closing}</p> : null}
          {doc.company.signer_name ? (
            <div className="mt-5 text-sm">
              <p>Respectfully,</p>
              <p className="mt-2 font-medium">{doc.company.signer_name}</p>
              {doc.company.signer_title ? <p className="text-neutral-600">{doc.company.signer_title}</p> : null}
              <p className="text-neutral-600">{companyName}</p>
            </div>
          ) : null}
        </Section>
      </div>

      {/* Sticky total (screen only) */}
      <div className="print-hide sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            {hasOptions ? "Your total" : "Total bid"}
          </p>
          <p className="font-heading text-lg font-semibold leading-tight tabular-nums" style={{ color: BRAND }}>
            {usd.format(total)}
          </p>
        </div>
        {accepted ? (
          <span className="text-sm text-green-800">✓ Accepted</span>
        ) : mode === "public" ? (
          <a
            href="#accept"
            className="rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ background: BRAND }}
          >
            Accept proposal
          </a>
        ) : (
          <span className="text-xs text-neutral-500">Preview — the client accepts from the shared link</span>
        )}
      </div>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14 pt-8">
      <h2 className="flex items-center gap-3 border-b border-neutral-200 pb-2">
        <span
          className="font-heading inline-flex h-7 w-9 items-center justify-center rounded text-xs font-bold text-white"
          style={{ background: BRAND }}
        >
          {n}
        </span>
        <span className="font-heading text-lg font-semibold">{title}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function Prose({
  text,
  placeholder,
  mode,
  className = "",
}: {
  text: string;
  placeholder?: string;
  mode: "preview" | "public";
  className?: string;
}) {
  if (!text.trim()) {
    return mode === "preview" && placeholder ? (
      <p className={`print-hide text-sm italic text-neutral-400 ${className}`}>{placeholder}</p>
    ) : null;
  }
  return <p className={`whitespace-pre-line text-sm leading-relaxed ${className}`}>{text}</p>;
}

function Breakdown({ doc }: { doc: ProposalDoc }) {
  const b = doc.pricing.buckets;
  const rows: [string, number][] = [
    ["Labor", b.labor],
    ["Materials", b.material],
    ["Subcontractors", b.sub],
    ["Equipment", b.equipment],
    ["Permits, fees & other", b.other],
    ["Lump-sum items", b.unsplit],
  ];
  const sum = rows.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <table className="mt-1 w-full">
      <tbody>
        {rows
          .filter(([, v]) => v > 0)
          .map(([label, v]) => (
            <tr key={label} className="border-b border-neutral-100">
              <td className="py-1 pr-3 text-neutral-700">{label}</td>
              <td className="py-1 text-right tabular-nums">{usd.format(v)}</td>
              <td className="w-12 py-1 text-right text-xs text-neutral-500 tabular-nums">
                {Math.round((v / sum) * 100)}%
              </td>
            </tr>
          ))}
        {doc.pricing.steps.some((s) => s.pct > 0) ? (
          <tr>
            <td className="py-1 pr-3 text-neutral-700">Markups (see below)</td>
            <td className="py-1 text-right tabular-nums">
              {usd.format(doc.pricing.steps.reduce((a, s) => a + s.amount, 0))}
            </td>
            <td />
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function AcceptBlock({
  doc,
  mode,
  accepted,
  expired,
  selected,
  total,
  onAccept,
}: {
  doc: ProposalDoc;
  mode: "preview" | "public";
  accepted: AcceptedInfo;
  expired: boolean;
  selected: Set<string>;
  total: number;
  onAccept?: (input: { name: string; email: string; selection: string[] }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  // Who is signing. Both are required before the agreement can be ticked - a
  // signature with no way to reach the signer is not worth much on a contract.
  const isIdentified = (n: string, e: string) =>
    n.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
  const identified = isIdentified(name, email);
  // Editing the name or email back out again withdraws the agreement, so a
  // tick can never outlive the identity it was given under.
  function editName(v: string) {
    setName(v);
    if (!isIdentified(v, email)) setAgree(false);
  }
  function editEmail(v: string) {
    setEmail(v);
    if (!isIdentified(name, v)) setAgree(false);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AcceptedInfo>(null);
  const shown = accepted ?? done;

  async function submit() {
    if (!onAccept) return;
    setError(null);
    setBusy(true);
    const res = await onAccept({ name: name.trim(), email: email.trim(), selection: [...selected] });
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Could not record your acceptance.");
    else setDone({ name: name.trim(), at: new Date().toISOString() });
  }

  const chosen = doc.pricing.options.filter((o) => selected.has(o.id));

  return (
    <div className="rounded-lg border border-neutral-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-neutral-700">
          Accepting this proposal authorizes {doc.company.company_name || "XtraUnit"} to prepare the
          contract for <span className="font-medium">{doc.project.name}</span> at the total below.
        </p>
        <p className="font-heading text-2xl font-semibold tabular-nums" style={{ color: BRAND }}>
          {usd.format(total)}
        </p>
      </div>
      {chosen.length ? (
        <p className="mt-1 text-xs text-neutral-600">
          Including: {chosen.map((o) => o.title).join(", ")}
        </p>
      ) : null}
      {doc.valid_until ? (
        <p className={`mt-1 text-xs ${expired ? "text-red-700" : "text-neutral-600"}`}>
          {expired
            ? `This pricing expired on ${formatDate(doc.valid_until)} — ask us for a refreshed proposal.`
            : `This pricing is valid through ${formatDate(doc.valid_until)}.`}
        </p>
      ) : null}

      {shown ? (
        <div className="mt-4 rounded-md border border-green-600/40 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p className="font-medium">✓ Accepted by {shown.name}</p>
          <p className="text-xs">{formatDate(shown.at)} · We&apos;ll be in touch with the contract shortly.</p>
        </div>
      ) : (
        <>
          <div className="print-hide mt-4 grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => editName(e.target.value)}
              placeholder="Your full name (this is your signature)"
              disabled={mode !== "public" || expired}
              aria-label="Full name"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-600 disabled:bg-neutral-50"
            />
            <input
              value={email}
              onChange={(e) => editEmail(e.target.value)}
              placeholder="Email"
              type="email"
              disabled={mode !== "public" || expired}
              aria-label="Email"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-600 disabled:bg-neutral-50"
            />
          </div>
          {/*
            F2 - signing runs in order: name and email first, then the
            agreement becomes available, then Accept. The checkbox used to be
            tickable before either field was filled, so someone could agree to
            a contract and only then be asked who they were - and the Accept
            button would sit there disabled with nothing saying why.

            `identified` gates the checkbox; the hint under it says what is
            still needed instead of leaving the reader to work it out.
          */}
          <label
            className={`print-hide mt-2 flex items-start gap-2 text-xs ${
              identified ? "text-neutral-700" : "text-neutral-400"
            }`}
          >
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              disabled={mode !== "public" || expired || !identified}
              className="mt-0.5" style={{ accentColor: "var(--brand)" }}
            />
            I have read the scope, pricing, timeline{doc.contract?.home_improvement ? ", terms and the home improvement contract section" : " and terms"} above
            and accept this proposal on behalf of the owner, and I have received a copy of it. Typing my name
            serves as my electronic signature{doc.contract?.home_improvement ? ", and today's date is the date of the contract" : ""}.
          </label>
          {mode === "public" && !expired && !identified ? (
            <p className="print-hide mt-1 text-xs text-neutral-500">
              Enter your name and email above to accept.
            </p>
          ) : null}
          <div className="print-hide mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={mode !== "public" || expired || busy || !agree || !identified}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              style={{ background: BRAND }}
            >
              {busy ? "Recording…" : "Accept proposal"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:border-neutral-500"
            >
              Print / Save as PDF
            </button>
            {mode === "preview" ? (
              <span className="text-xs text-neutral-500">Disabled in preview — the client accepts from the shared link.</span>
            ) : null}
            {error ? <span className="text-xs text-red-700">{error}</span> : null}
          </div>
          {/* Wet-ink lines for the printed copy */}
          <div className="print-only mt-8 grid grid-cols-2 gap-10 text-xs">
            <p className="border-t border-neutral-500 pt-1 text-neutral-600">Owner / Authorized Agent — Signature &amp; Date</p>
            <p className="border-t border-neutral-500 pt-1 text-neutral-600">
              {doc.company.company_name || "XtraUnit Construction"} — Signature &amp; Date
            </p>
          </div>
        </>
      )}
    </div>
  );
}
