/**
 * The California home improvement contract block — rendered inside the
 * proposal document when the project is residential work for its owner.
 *
 * Order, headings and the sentences in bold follow B&P §7159 (2026). The
 * statute wants certain statements in at least 12-point bold and headings
 * in at least 10-point bold, so the print sizes here are not a design
 * choice. The Notice of Cancellation is a separate page, in duplicate,
 * because the buyer keeps two copies.
 *
 * Reads from the doc only — no state, no server — so the preview, the
 * client's share link and the print are identical.
 */
import type { ProposalDoc } from "@/lib/proposal/model";
import {
  BOND_NOTICE,
  CANCELLATION_ADDRESS_STATEMENT,
  CHANGE_ORDER_NOTE,
  CSLB_NOTICE,
  DOWNPAYMENT_STATEMENT,
  ENTITLED_TO_COPY,
  LIEN_RELEASE_STATEMENT,
  MECHANICS_LIEN_WARNING,
  PROGRESS_PAYMENT_STATEMENT,
  SUBCONTRACTOR_DISCLAIMER,
  cancelDays,
  cglStatement,
  downpaymentCap,
  noticeOfCancellationText,
  rightToCancelHeading,
  rightToCancelText,
  scheduleGap,
  workersCompStatement,
} from "@/lib/proposal/contract";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** A statutory statement the law wants in 12-point bold. */
function Bold12({ children }: { children: React.ReactNode }) {
  return <p className="text-[12pt] font-bold leading-snug">{children}</p>;
}
function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 text-[10pt] font-bold uppercase tracking-wide">{children}</h3>;
}
function Paras({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {text.split("\n\n").map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export default function ContractTerms({ doc, contractPrice }: { doc: ProposalDoc; contractPrice: number }) {
  const c = doc.contract;
  const co = doc.company;
  const name = co.company_name || "This contractor";
  const days = cancelDays(c.senior);
  const cap = downpaymentCap(contractPrice);
  const gap = scheduleGap(c, contractPrice);
  const overCap = c.downpayment > cap;

  return (
    <div className="text-[10pt] leading-relaxed text-neutral-800">
      {/* Heading the statute names, and the sentence that must sit near the top */}
      <p className="text-[12pt] font-bold uppercase tracking-wide">Home Improvement</p>
      <p className="mt-1 text-xs text-neutral-600">
        This section makes the accepted proposal a home improvement contract under California Business and Professions
        Code §7159. It is part of the agreement.
      </p>
      <div className="mt-3">
        <Bold12>{ENTITLED_TO_COPY}</Bold12>
      </div>

      {/* Contractor block, with the statement AB 1327 puts in front of it */}
      <H>Contractor</H>
      <p className="text-xs text-neutral-600">{CANCELLATION_ADDRESS_STATEMENT}</p>
      <p className="mt-1">
        <span className="font-semibold">{name}</span>
        {co.company_license ? <> · License {co.company_license}</> : null}
      </p>
      <p>{[co.company_address, co.company_email, co.company_phone].filter(Boolean).join(" · ")}</p>

      {/* Price */}
      <H>Contract Price</H>
      <p className="text-[12pt] font-bold">{usd.format(contractPrice)}</p>
      <p className="text-xs text-neutral-600">
        The base bid plus the options selected at acceptance. No finance charge is imposed by the contractor.
      </p>

      {/* Description — the scope and pricing sections above are the description the statute asks for */}
      <H>Description of the Project and Description of the Significant Materials to be Used and Equipment to be Installed</H>
      <p>
        The work is described in Sections 02 (Scope of work) and 03 (Pricing) of this proposal, by trade, including the
        items excluded, and in the plans and documents listed under &ldquo;Documents incorporated&rdquo; below.
        {doc.profile.finish_note ? ` ${doc.profile.finish_note}` : ""}
      </p>

      {/* Down payment */}
      <H>Downpayment</H>
      <p>
        <span className="font-semibold">{usd.format(c.downpayment)}</span>, due at signing.
        {overCap ? (
          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-800 print-hide">
            Over the legal cap of {usd.format(cap)} — fix before sending
          </span>
        ) : null}
      </p>
      <div className="mt-1">
        <Bold12>{DOWNPAYMENT_STATEMENT}</Bold12>
      </div>

      {/* Progress payments */}
      <H>Schedule of Progress Payments</H>
      {c.progress_payments.length ? (
        <table className="mt-1 w-full border-collapse text-[10pt]">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-1 pr-2">Phase</th>
              <th className="py-1 pr-2">Work or services supplied in this phase</th>
              <th className="py-1 text-right">Payment</th>
            </tr>
          </thead>
          <tbody>
            {c.progress_payments.map((p, i) => (
              <tr key={i} className="border-b border-neutral-200 align-top">
                <td className="py-1 pr-2 font-medium">{p.phase}</td>
                <td className="py-1 pr-2 text-neutral-700">{p.work}</td>
                <td className="py-1 text-right tabular-nums">{usd.format(p.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1 pr-2" colSpan={2}>
                Downpayment {usd.format(c.downpayment)} + progress payments
              </td>
              <td className="py-1 text-right tabular-nums">{usd.format(contractPrice - gap)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-neutral-600">
          Progress payments are invoiced against work in place at the milestones in Section 04 and are due within 10
          days; the last payment is due at completion.
        </p>
      )}
      {gap !== 0 && c.progress_payments.length ? (
        <p className="print-hide mt-1 text-xs font-semibold text-red-800">
          Schedule is {gap > 0 ? "short" : "over"} by {usd.format(Math.abs(gap))} against the contract price — fix before
          sending.
        </p>
      ) : null}
      <div className="mt-2">
        <Bold12>{PROGRESS_PAYMENT_STATEMENT}</Bold12>
      </div>
      <p className="mt-2">{LIEN_RELEASE_STATEMENT}</p>

      {/* Dates */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10pt] font-bold uppercase tracking-wide">Approximate Start Date</p>
          <p>{c.start_date || doc.timeline.start || "—"}</p>
        </div>
        <div>
          <p className="text-[10pt] font-bold uppercase tracking-wide">Approximate Completion Date</p>
          <p>{c.completion_date || (doc.timeline.duration ? `${doc.timeline.duration} after start` : "—")}</p>
        </div>
      </div>

      <H>List of Documents to be Incorporated into the Contract</H>
      <p>
        This proposal (Sections 01–07), the plans and specifications the scope was priced from, the schedule of progress
        payments above, and every change order signed by both parties.
      </p>

      <H>Note About Extra Work and Change Orders</H>
      <p>{CHANGE_ORDER_NOTE}</p>

      {/* Subcontractors — 2026 */}
      <H>Subcontractors</H>
      <p>
        Will subcontractors be used on this project?{" "}
        <span className="font-mono">[{c.uses_subcontractors ? "X" : "  "}] Yes</span>{" "}
        <span className="font-mono">[{c.uses_subcontractors ? "  " : "X"}] No</span>
      </p>
      {c.uses_subcontractors ? <p className="mt-1">{SUBCONTRACTOR_DISCLAIMER}</p> : null}
      <p className="mt-1">{BOND_NOTICE}</p>

      {/* Insurance */}
      <H>Commercial General Liability Insurance (CGL)</H>
      <p>{cglStatement(name, doc.profile.compliance)}</p>
      <H>Workers&rsquo; Compensation Insurance</H>
      <p>{workersCompStatement(name, doc.profile.compliance)}</p>

      {/* The two long notices */}
      <H>Mechanics Lien Warning</H>
      <Paras text={MECHANICS_LIEN_WARNING} className="text-[10pt]" />

      <H>Information about the Contractors State License Board (CSLB)</H>
      <Paras text={CSLB_NOTICE} className="text-[12pt]" />

      {/* Right to cancel */}
      <p className="mt-5 text-[12pt] font-bold">{rightToCancelHeading(days)}</p>
      <Paras text={rightToCancelText(days)} className="mt-1 text-[12pt] font-bold" />

      {/* The tear-off form, twice, each on its own printed page */}
      {[1, 2].map((copy) => (
        <div key={copy} className="mt-8 break-before-page rounded-md border border-neutral-400 p-4">
          <p className="text-[12pt] font-bold">Notice of Cancellation</p>
          <p className="mt-1 text-xs text-neutral-600">
            Copy {copy} of 2 — keep this form. Date of transaction: ______________________
          </p>
          <Paras text={noticeOfCancellationText(days)} className="mt-3" />
          <p className="mt-3">
            To cancel this transaction, email, mail, or deliver a signed and dated copy of this cancellation notice, or any
            other written notice, to <span className="font-semibold">{name}</span> at{" "}
            <span className="font-semibold">{[co.company_address, co.company_email].filter(Boolean).join(" or ") || "________"}</span>{" "}
            not later than midnight of ______________________ (date).
            {co.company_phone ? ` For help with this form, call ${co.company_phone}.` : ""}
          </p>
          <p className="mt-4">I hereby cancel this transaction.</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <p className="border-t border-neutral-500 pt-1 text-xs">Date</p>
            <p className="border-t border-neutral-500 pt-1 text-xs">Buyer&rsquo;s signature</p>
          </div>
        </div>
      ))}
    </div>
  );
}
