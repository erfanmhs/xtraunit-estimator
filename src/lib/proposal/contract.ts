/**
 * The contract layer of a proposal — what turns "a bid the client accepts"
 * into a document a California contractor can actually be held to, and be
 * safe behind.
 *
 * Two kinds of project:
 *
 *   HOME IMPROVEMENT — work on residential property for its owner (a remodel,
 *   an addition, an ADU, a custom home for the family that will live in it).
 *   California regulates this contract in detail (Business & Professions
 *   Code §7159, as amended for 2026 by AB 1327 and SB 517): specific
 *   headings, specific sentences in specific type sizes, a down-payment cap,
 *   a schedule of progress payments, a mechanics-lien warning, a CSLB notice,
 *   insurance statements, a subcontractor disclosure, and a right to cancel
 *   with its own tear-off form. Miss one and the contract is voidable and
 *   the license is exposed. The wording below is the statute's, verbatim
 *   where the statute prescribes it.
 *
 *   COMMERCIAL / OTHER — the general terms apply and the statutory home
 *   improvement blocks are left out.
 *
 * Shared by the server (builder, publish) and the client (renderer, editor):
 * plain data and pure functions, no server-only imports.
 *
 * Not legal advice. The text was assembled from the statute and standard
 * residential contract practice; an attorney should read it once before it
 * goes out under the company's name — see docs/PROPOSAL-CONTRACT.md.
 */

// ── Per-proposal contract fields (proposals.contract, migration 0043) ───────

export type ProgressPayment = {
  /** "Rough framing complete" — the phase, as the statute wants it described. */
  phase: string;
  /** "Foundation poured and inspected; framing lumber delivered" */
  work: string;
  amount: number;
};

export type ProposalContract = {
  /** Treat this as a California home improvement contract (statutory blocks on). */
  home_improvement: boolean;
  /** Buyer is 65 or older → five-day right to cancel instead of three. */
  senior: boolean;
  /** One or more subcontractors will be used (the 2026 disclosure). */
  uses_subcontractors: boolean;
  /** "2026-05-01" or "Within 3 weeks of permit issuance" — as the statute allows either. */
  start_date: string;
  completion_date: string;
  /** Dollars; capped by law at the lesser of $1,000 or 10 %. */
  downpayment: number;
  progress_payments: ProgressPayment[];
};

export const HOME_IMPROVEMENT_TYPES = new Set(["residential", "adu_addition", "multifamily"]);

/** A fresh contract block for a project, with the statutory default already set. */
export function defaultContract(projectType: string | null): ProposalContract {
  return {
    home_improvement: HOME_IMPROVEMENT_TYPES.has(projectType ?? ""),
    senior: false,
    uses_subcontractors: true,
    start_date: "",
    completion_date: "",
    downpayment: 0,
    progress_payments: [],
  };
}

/** Read a stored contract block, tolerating anything older or missing. */
export function resolveContract(raw: unknown, projectType: string | null): ProposalContract {
  const d = defaultContract(projectType);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<ProposalContract>;
  const pays = Array.isArray(r.progress_payments)
    ? r.progress_payments
        .map((p) => ({
          phase: String(p?.phase ?? "").trim(),
          work: String(p?.work ?? "").trim(),
          amount: Number(p?.amount) || 0,
        }))
        .filter((p) => p.phase || p.work || p.amount)
    : [];
  return {
    home_improvement: typeof r.home_improvement === "boolean" ? r.home_improvement : d.home_improvement,
    senior: !!r.senior,
    uses_subcontractors: typeof r.uses_subcontractors === "boolean" ? r.uses_subcontractors : true,
    start_date: String(r.start_date ?? "").trim(),
    completion_date: String(r.completion_date ?? "").trim(),
    downpayment: Math.max(0, Number(r.downpayment) || 0),
    progress_payments: pays,
  };
}

// ── The numbers the statute fixes ───────────────────────────────────────────

/** The most a home improvement contract may take up front: $1,000 or 10 %, whichever is LESS. */
export function downpaymentCap(contractPrice: number): number {
  return Math.max(0, Math.min(1000, Math.round(contractPrice * 0.1)));
}

/** Days in the right to cancel: three, or five for a buyer 65 or older. */
export function cancelDays(senior: boolean): 3 | 5 {
  return senior ? 5 : 3;
}

/**
 * The statutory schedule must add up: down payment + progress payments =
 * contract price. Returns the shortfall (positive) or excess (negative).
 */
export function scheduleGap(c: ProposalContract, contractPrice: number): number {
  const sum = c.downpayment + c.progress_payments.reduce((n, p) => n + p.amount, 0);
  return Math.round((contractPrice - sum) * 100) / 100;
}

// ── Company-level compliance answers (stored on the proposal profile) ───────

export type CglStatus = "carried" | "none" | "self" | "llc";
export type WorkersCompStatus = "employees" | "exempt";

export type Compliance = {
  cgl: CglStatus;
  cgl_carrier: string;
  cgl_phone: string;
  workers_comp: WorkersCompStatus;
};

export const DEFAULT_COMPLIANCE: Compliance = {
  cgl: "carried",
  cgl_carrier: "",
  cgl_phone: "",
  workers_comp: "employees",
};

/** §7159(e)(1) — the sentence the contract must carry, chosen by the company's answer. */
export function cglStatement(name: string, c: Compliance): string {
  const who = name.trim() || "This contractor";
  switch (c.cgl) {
    case "none":
      return `${who} does not carry commercial general liability insurance.`;
    case "self":
      return `${who} is self-insured.`;
    case "llc":
      return `${who} is a limited liability company that carries liability insurance or maintains other security as required by law. You may call ${c.cgl_carrier || "the insurer"} at ${c.cgl_phone || "________"} to check on the contractor's insurance coverage or security.`;
    default:
      return `${who} carries commercial general liability insurance written by ${c.cgl_carrier || "________"}. You may call ${c.cgl_carrier || "the insurer"} at ${c.cgl_phone || "________"} to check the contractor's insurance coverage.`;
  }
}

/** §7159(e)(2) */
export function workersCompStatement(name: string, c: Compliance): string {
  const who = name.trim() || "This contractor";
  return c.workers_comp === "exempt"
    ? `${who} has no employees and is exempt from workers' compensation requirements.`
    : `${who} carries workers' compensation insurance for all employees.`;
}

// ── Statutory text, verbatim (B&P §7159, 2026) ──────────────────────────────

/** §7159(d)(2) — 12-point boldface. */
export const ENTITLED_TO_COPY =
  "You are entitled to a completely filled in copy of this agreement, signed by both you and the contractor, before any work may be started.";

/** §7159(d)(8) — 12-point boldface. */
export const DOWNPAYMENT_STATEMENT =
  "THE DOWNPAYMENT MAY NOT EXCEED $1,000 OR 10 PERCENT OF THE CONTRACT PRICE, WHICHEVER IS LESS.";

/** §7159(d)(9) — 12-point boldface. */
export const PROGRESS_PAYMENT_STATEMENT =
  "The schedule of progress payments must specifically describe each phase of work, including the type and amount of work or services scheduled to be supplied in each phase, along with the amount of each proposed progress payment. IT IS AGAINST THE LAW FOR A CONTRACTOR TO COLLECT PAYMENT FOR WORK NOT YET COMPLETED, OR FOR MATERIALS NOT YET DELIVERED. HOWEVER, A CONTRACTOR MAY REQUIRE A DOWNPAYMENT.";

/** §7159(d)(12) — under the heading "Note About Extra Work and Change Orders". */
export const CHANGE_ORDER_NOTE =
  "Extra Work and Change Orders become part of the contract once the order is prepared in writing and signed by the parties prior to the commencement of work covered by the new change order. The order must describe the scope of the extra work or change, the cost to be added or subtracted from the contract, and the effect the order will have on the schedule of progress payments.";

/** §7159(c) — the lien-release promise. */
export const LIEN_RELEASE_STATEMENT =
  "Upon satisfactory payment being made for any portion of the work performed, the contractor, prior to any further payment being made, shall furnish to the person contracting for the home improvement or swimming pool work a full and unconditional release from any potential lien claimant claim or mechanics lien authorized pursuant to Sections 8400 and 8404 of the Civil Code for that portion of the work for which payment has been made.";

/** §7159(c) — the bond notice. */
export const BOND_NOTICE =
  "The owner or tenant has the right to require the contractor to have a performance and payment bond.";

/** §7159(c) (2026, SB 517) — the sentence that follows a "Yes" on subcontractors. */
export const SUBCONTRACTOR_DISCLAIMER =
  "One or more subcontractors will be used on this project, and the contractor is aware that a list of subcontractors is required to be provided, upon request, along with the names, contact information, license number, and classification of those subcontractors.";

/** §7159(c) (2026, AB 1327) — precedes the contractor's name, address, email on the first page. */
export const CANCELLATION_ADDRESS_STATEMENT =
  "The Notice of Cancellation may be sent to the contractor at the address or email address noted below.";

/** §7159(e)(4) — verbatim. */
export const MECHANICS_LIEN_WARNING = `Anyone who helps improve your property, but who is not paid, may record what is called a mechanics lien on your property. A mechanics lien is a claim, like a mortgage or home equity loan, made against your property and recorded with the county recorder.

Even if you pay your contractor in full, unpaid subcontractors, suppliers, and laborers who helped to improve your property may record mechanics liens and sue you in court to foreclose the lien. If a court finds the lien is valid, you could be forced to pay twice or have a court officer sell your home to pay the lien. Liens can also affect your credit.

To preserve their right to record a lien, each subcontractor and material supplier must provide you with a document called a 'Preliminary Notice.' This notice is not a lien. The purpose of the notice is to let you know that the person who sends you the notice has the right to record a lien on your property if they are not paid.

BE CAREFUL. The Preliminary Notice can be sent up to 20 days after the subcontractor starts work or the supplier provides material. This can be a big problem if you pay your contractor before you have received the Preliminary Notices.

You will not get Preliminary Notices from your prime contractor or from laborers who work on your project. The law assumes that you already know they are improving your property.

PROTECT YOURSELF FROM LIENS. You can protect yourself from liens by getting a list from your contractor of all the subcontractors and material suppliers that work on your project. Find out from your contractor when these subcontractors started work and when these suppliers delivered goods or materials. Then wait 20 days, paying attention to the Preliminary Notices you receive.

PAY WITH JOINT CHECKS. One way to protect yourself is to pay with a joint check. When your contractor tells you it is time to pay for the work of a subcontractor or supplier who has provided you with a Preliminary Notice, write a joint check payable to both the contractor and the subcontractor or material supplier.

For other ways to prevent liens, visit CSLB's internet website at www.cslb.ca.gov or call CSLB at 800-321-CSLB (2752).

REMEMBER, IF YOU DO NOTHING, YOU RISK HAVING A LIEN PLACED ON YOUR HOME. This can mean that you may have to pay twice, or face the forced sale of your home to pay what you owe.`;

/** §7159(e)(5) — verbatim, 12-point. */
export const CSLB_NOTICE = `CSLB is the state consumer protection agency that licenses and regulates construction contractors.

Contact CSLB for information about the licensed contractor you are considering, including information about disclosable complaints, disciplinary actions, and civil judgments that are reported to CSLB.

Use only licensed contractors. If you file a complaint against a licensed contractor within the legal deadline (usually four years), CSLB has authority to investigate the complaint. If you use an unlicensed contractor, CSLB may not be able to help you resolve your complaint. Your only remedy may be in civil court, and you may be liable for damages arising out of any injuries to the unlicensed contractor or the unlicensed contractor's employees.

For more information: Visit CSLB's internet website at www.cslb.ca.gov · Call CSLB at 800-321-CSLB (2752) · Write CSLB at P.O. Box 26000, Sacramento, CA 95826.`;

const ORD = { 3: ["three", "third"], 5: ["five", "fifth"] } as const;

/** §7159(e)(6)(B)(i) — 12-point boldface heading "Three-Day Right to Cancel" (five for seniors). */
export function rightToCancelHeading(days: 3 | 5): string {
  return days === 5 ? "Five-Day Right to Cancel" : "Three-Day Right to Cancel";
}
export function rightToCancelText(days: 3 | 5): string {
  const [n, nth] = ORD[days];
  return `You, the buyer, have the right to cancel this contract within ${n} business days. You may cancel by emailing, mailing, faxing, or delivering a written notice to the contractor at the contractor's place of business by midnight of the ${nth} business day after you received a signed and dated copy of the contract that includes this notice. Include your name, your address, and the date you received the signed copy of the contract and this notice.

If you cancel, the contractor must return to you anything you paid within 10 days of receiving the notice of cancellation. For your part, you must make available to the contractor at your residence, in substantially as good condition as you received them, goods delivered to you under this contract or sale. Or, you may, if you wish, comply with the contractor's instructions on how to return the goods at the contractor's expense and risk. If you do make the goods available to the contractor and the contractor does not pick them up within 20 days of the date of your notice of cancellation, you may keep them without any further obligation. If you fail to make the goods available to the contractor, or if you agree to return the goods to the contractor and fail to do so, then you remain liable for performance of all obligations under the contract.`;
}

/** §7159(e)(6)(B)(vi) — the tear-off form's body. Given in duplicate to the buyer. */
export function noticeOfCancellationText(days: 3 | 5): string {
  const [n] = ORD[days];
  return `You may cancel this transaction, without any penalty or obligation, within ${n} business days from the above date.

If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within 10 days following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be canceled.

If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller's expense and risk.

If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to the seller, or if you agree to return the goods to the seller and fail to do so, then you remain liable for performance of all obligations under the contract.`;
}
