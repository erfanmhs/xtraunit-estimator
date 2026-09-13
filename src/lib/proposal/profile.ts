/**
 * Proposal profile — the company's standard, reusable proposal sections.
 *
 * These are the parts that read the same on every XtraUnit bid: Who We Are,
 * Why We're the Right Fit, Next Steps, the license note, the finish-package
 * note, the Terms & Conditions, the standard "Excluded / by others" list, and
 * the project references (social proof). The owner sets them up once
 * (Settings → Proposal profile); the AI only writes the project-specific
 * parts. Stored as JSON on company_settings.proposal_profile — adding fields
 * here needs no migration.
 *
 * Shared by the Settings editor (client) and the Proposal (server) — plain
 * data, no server-only imports.
 */

import { DEFAULT_COMPLIANCE, type Compliance } from "./contract";

export type WhyBullet = { title: string; body: string };

/**
 * The general terms — the clauses a residential/commercial contract needs
 * beyond what California prescribes word for word (those live in
 * contract.ts and render only on home improvement contracts). Order here is
 * the order they print.
 */
export type ProposalTerms = {
  agreement: string;
  the_work: string;
  change_orders: string;
  concealed_conditions: string;
  allowances: string;
  payment: string;
  completion: string;
  schedule: string;
  owner_responsibilities: string;
  permits: string;
  site_safety: string;
  hazardous_materials: string;
  force_majeure: string;
  insurance: string;
  indemnity: string;
  warranty: string;
  termination: string;
  disputes: string;
  general: string;
};

/** A past project offered as proof — type/scale, the challenge, what was delivered. */
export type ProjectReference = {
  title: string; // "24-unit multifamily, Van Nuys"
  type_scale: string; // "New construction · 4 stories · 32,000 SF"
  challenge: string; // what made it hard
  delivered: string; // what we delivered (outcome, numbers)
  photo_url: string; // a link to a finished-work photo ("" = none)
};

export type ProposalProfile = {
  who_we_are: string;
  why_fit: WhyBullet[];
  next_steps: string;
  license_note: string;
  finish_note: string;
  closing: string;
  terms: ProposalTerms;
  standard_exclusions: string[];
  references: ProjectReference[];
  /** The company's answers to the insurance statements the contract must carry. */
  compliance: Compliance;
};

export const TERM_LABELS: Record<keyof ProposalTerms, string> = {
  agreement: "The agreement",
  the_work: "The work & supervision",
  change_orders: "Change orders",
  concealed_conditions: "Concealed conditions",
  allowances: "Allowances & selections",
  payment: "Payment terms",
  completion: "Completion & final payment",
  schedule: "Schedule",
  owner_responsibilities: "Owner responsibilities",
  permits: "Permits, inspections & code",
  site_safety: "Site, safety & clean-up",
  hazardous_materials: "Hazardous materials",
  force_majeure: "Delays beyond either party's control",
  insurance: "Insurance",
  indemnity: "Responsibility for claims",
  warranty: "Warranty & correction of work",
  termination: "Termination",
  disputes: "Dispute resolution",
  general: "General",
};

/**
 * Plain-language defaults, written to stand up as a residential contract in
 * California and to read like the company wrote them. Numbers a contractor
 * usually tunes (retention, late interest, warranty term) are in the text
 * on purpose: they are visible and editable in Settings. Reviewed against
 * AIA A105 and standard residential practice; not legal advice — see
 * docs/PROPOSAL-CONTRACT.md for what an attorney should still check.
 */
export const DEFAULT_TERMS: ProposalTerms = {
  agreement:
    "When the owner accepts this proposal, this proposal — its scope, pricing, options selected, timeline, terms and, for home improvement work, the contract section — becomes the whole agreement between the owner and the contractor for this project. It replaces every earlier quote or conversation. The plans and specifications listed in the scope are part of it and are to be read together; if they disagree, this proposal's scope and exclusions control what is priced, then the specifications, then the drawings. Drawings and specifications remain the property of whoever prepared them and are used only for this project.",
  the_work:
    "The contractor performs the work described, with materials and equipment of the quality specified (new unless the scope says otherwise), and is responsible for the means, methods and sequencing of construction and for supervising the work with a competent superintendent who is on site whenever work is in progress. The contractor pays the sales, use and payroll taxes the work incurs. The contractor has reviewed the plans and the site before pricing and will report any error or conflict it finds to the owner before building through it.",
  change_orders:
    "Any change to the scope, materials, schedule or site conditions after this proposal is priced as a written change order, signed by both parties before the affected work starts. The order states what changes, what it adds to or takes off the contract price, and how it moves the schedule and the progress payments. Work requested on site without a signed change order is done at the contractor's discretion and billed at cost plus the overhead and profit rate in this proposal.",
  concealed_conditions:
    "The price assumes conditions that a careful inspection of the property and the plans would show. Conditions found only once work is open — dry rot, termite damage, unpermitted earlier work, buried utilities, rock, groundwater, structural defects, or anything else concealed — are not in the price. The contractor will stop work in that area, tell the owner in writing within two working days, and price the fix as a change order.",
  allowances:
    "Where the scope lists an allowance, that amount is what the price carries for that item. If the owner's selection costs more, the difference is added by change order; if less, the difference is credited. Owner selections are due by the dates in the timeline; a late selection extends the schedule by the same number of days and may add re-mobilisation cost.",
  payment:
    "A deposit is due at signing; for home improvement work it is capped by California law at $1,000 or 10 % of the contract price, whichever is less. Progress payments are invoiced against work in place and materials delivered, as the schedule of progress payments sets out, and are due within 10 days of the invoice. The final payment is due at completion, after the final inspection is signed off and the owner has received an unconditional lien release for the work. Amounts unpaid 10 days after they are due accrue interest at 1.5 % per month, and the contractor may suspend work after 7 days' written notice until the account is current.",
  completion:
    "Substantial completion is the point at which the work, or a part the owner agrees to take, is complete enough to use for its purpose, with only punch-list items left. The contractor gives written notice; the owner and contractor walk the work together and list what remains. Final payment is due when the punch list is done, the final inspection is signed off, and the contractor has delivered unconditional lien releases from itself and every subcontractor and supplier who gave a preliminary notice, together with warranties and operating instructions. Time is of the essence in this agreement; the contractor gives prompt written notice of any delay it becomes aware of and asks for any extension by change order.",
  schedule:
    "The timeline starts when the deposit is received, permits are issued and the site is available. Approximate dates are estimates made in good faith; they move with change orders, owner selections, permit and inspection timing, weather and the other causes listed under delays. The contractor keeps the owner informed of schedule changes as they happen.",
  owner_responsibilities:
    "The owner provides access to the site during working hours, a place for materials and a dumpster, water and power, and decisions and selections by the dates in the timeline. The owner keeps children and pets away from the work area, removes or protects belongings in it, and tells the contractor about known hazards, easements, HOA rules and prior unpermitted work. The owner is responsible for the accuracy of any surveys, plans or reports the owner supplies.",
  permits:
    "The contractor obtains the building permits the scope names and schedules inspections. Permit, plan-check and utility fees are paid by the owner at cost unless the scope says otherwise. Work is performed to the codes in force when the permit is issued. Code upgrades required by an inspector that the plans did not show are a concealed condition.",
  site_safety:
    "The contractor keeps the site safe and orderly, follows the safety laws that apply to its work, protects the owner's property and the neighbours' from damage caused by its operations, and repairs any such damage at its own cost. The contractor removes its debris regularly and leaves the site broom-clean at completion. The contractor confines its work, storage and vehicles to the areas the owner makes available, and does cutting and patching of existing work only as the scope needs.",
  hazardous_materials:
    "The price does not include finding, testing for, or removing asbestos, lead paint, mould or other hazardous materials. If any is found the contractor stops work in that area at once, and the owner arranges testing and licensed abatement. The schedule extends by the time this takes.",
  force_majeure:
    "Neither party is responsible for delays caused by events beyond its reasonable control: severe weather, fire, earthquake, strikes, material or labour shortages, supplier failures, epidemics, or government action. The schedule extends by the length of the delay. Cost increases in materials caused by such events, or by tariffs or manufacturer price changes after this proposal's date, are shared by change order at cost, with no markup on the increase.",
  insurance:
    "The contractor carries commercial general liability and workers' compensation insurance as stated in the contract section, and provides certificates on request. The owner maintains property insurance on the structure, including course-of-construction (builder's risk) coverage for the full value of the work, and names the contractor as an additional insured for the project. To the extent a loss is covered by that property insurance, the owner and the contractor waive their rights against each other and against subcontractors for the loss, so the insurance pays rather than the parties suing each other.",
  indemnity:
    "Each party is responsible for claims, damage and injury caused by its own negligence or that of the people it controls, and will defend and hold the other harmless from such claims to the extent of its share of fault. Neither party is liable to the other for consequential or indirect losses such as lost rent, lost profit or the cost of alternative housing.",
  warranty:
    "The contractor warrants its workmanship for one year from substantial completion and will correct defective or non-conforming work reported in writing during that year, promptly and at no cost to the owner, including any damage the correction requires to other work. Manufacturer warranties on materials, fixtures and equipment are issued in the owner's name or transferred to the owner. This warranty does not cover normal wear, owner-supplied items, damage from misuse, settlement, moisture from sources outside the work, or work by others. Nothing here shortens the rights California law gives the owner.",
  termination:
    "Either party may end the agreement if the other materially breaches it and does not cure within 10 days of written notice — for the owner, that includes not paying an undisputed invoice; for the contractor, abandoning the work or repeatedly failing to correct defective work. If the contractor fails to correct defective work after notice, the owner may also stop the affected work until it is corrected, or have it corrected by others and deduct the reasonable cost. If the owner ends the agreement for any other reason, the owner pays for work performed and materials ordered to that date, plus 10 % of the remaining contract price for the contractor's overhead and demobilisation. Either way the contractor leaves the site safe and clean and hands over permits, plans and warranties for the work done.",
  disputes:
    "Disagreements go first to a meeting between the owner and the contractor's principal, then to mediation in Los Angeles County. Anything still unresolved is decided by binding arbitration under California law, in Los Angeles County, and the prevailing party recovers reasonable attorney's fees and costs. Either party may also use small claims court or file a complaint with the Contractors State License Board. Nothing here limits the owner's rights under California consumer protection law.",
  general:
    "Notices under this agreement are in writing and may be sent by email to the addresses on the first page. Neither party assigns this agreement without the other's written consent, except that the contractor may assign payments due to it to a lender. Tests and inspections the owner orders beyond those required by code are at the owner's cost unless they show the work does not conform. This agreement is governed by California law; if any part of it is held unenforceable, the rest stands. Accepting this proposal electronically has the same effect as signing it by hand.",
};

export const DEFAULT_EXCLUSIONS: string[] = [
  "Permit and plan-check fees — paid by the owner at cost unless listed in the scope",
  "Utility disconnects, reconnections, and utility-company fees",
  "Third-party inspections, testing, and special inspections",
  "Hazardous-material surveys and abatement (asbestos, lead, mold)",
  "Design, engineering, and survey fees",
  "Owner-furnished items and their installation unless listed",
  "Furniture, appliances, and window coverings",
];

// Sensible starting text, taken from XtraUnit's own proposals, so a new account
// produces a complete, on-brand proposal before editing anything.
export const DEFAULT_PROFILE: ProposalProfile = {
  who_we_are:
    "We are a young, educated construction firm founded by professionals who combine technical rigor with a modern, transparent approach to project management. Our background in both engineering and field operations lets us bridge the gap between design intent and site realities. We lead with curiosity and humility, and we treat every project like it matters, because it does. We work hard to anticipate issues before they become problems, and when they do, we handle them directly and constructively. This mindset has let us succeed in complex multifamily and mixed-use developments, even as a growing firm. We operate with the diligence and accountability that build trust with our partners.",
  why_fit: [
    {
      title: "Proactive Coordination",
      body: "We align quickly with design teams and authorities so there are no surprises in plan review or inspections.",
    },
    {
      title: "Lean Construction Focus",
      body: "We manage the schedule with intent, avoiding trade congestion and keeping forward momentum.",
    },
    {
      title: "Transparent Execution",
      body: "From daily field reporting to monthly budget reviews, we keep owners informed and empowered.",
    },
    {
      title: "Responsiveness",
      body: "We're agile, responsive, and willing to adjust course when needed.",
    },
  ],
  next_steps:
    "We welcome the opportunity to meet, walk through our bid assumptions, and discuss how we can support your vision for this project. We're prepared to move immediately into preconstruction services, including permit expediting, long-lead procurement, and trade-partner onboarding.",
  license_note:
    "XtraUnit holds an A-General Engineering license and is bonded with the City of Los Angeles. We can fully execute the excluded public-works, site, and off-site improvements under a separate contract.",
  finish_note:
    "For finish materials and fixtures we propose our Basic Package — the contractor's choice of materials and finishes that meet code for each scope of work. Submittals are available on request.",
  closing:
    "Thank you again for considering us. We look forward to the opportunity to build something outstanding together.",
  terms: DEFAULT_TERMS,
  standard_exclusions: DEFAULT_EXCLUSIONS,
  references: [],
  compliance: DEFAULT_COMPLIANCE,
};

function cleanCompliance(raw: unknown): Compliance {
  const c = (raw ?? {}) as Partial<Compliance>;
  const cgl = ["carried", "none", "self", "llc"].includes(String(c.cgl)) ? (c.cgl as Compliance["cgl"]) : DEFAULT_COMPLIANCE.cgl;
  const wc = c.workers_comp === "exempt" ? "exempt" : "employees";
  return {
    cgl,
    cgl_carrier: String(c.cgl_carrier ?? "").trim(),
    cgl_phone: String(c.cgl_phone ?? "").trim(),
    workers_comp: wc,
  };
}

function cleanRefs(raw: unknown): ProjectReference[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const x = (r ?? {}) as Partial<ProjectReference>;
      return {
        title: x.title?.trim() ?? "",
        type_scale: x.type_scale?.trim() ?? "",
        challenge: x.challenge?.trim() ?? "",
        delivered: x.delivered?.trim() ?? "",
        photo_url: x.photo_url?.trim() ?? "",
      };
    })
    .filter((r) => r.title || r.delivered);
}

/** Read a stored profile, filling any missing pieces from the defaults. */
export function resolveProfile(raw: unknown): ProposalProfile {
  const p = (raw ?? {}) as Partial<ProposalProfile>;
  const why =
    Array.isArray(p.why_fit) && p.why_fit.length
      ? p.why_fit.filter((b) => b && (b.title?.trim() || b.body?.trim()))
      : DEFAULT_PROFILE.why_fit;
  const t = (p.terms ?? {}) as Partial<ProposalTerms>;
  const terms = Object.fromEntries(
    (Object.keys(DEFAULT_TERMS) as (keyof ProposalTerms)[]).map((k) => [
      k,
      t[k]?.trim() || DEFAULT_TERMS[k],
    ]),
  ) as ProposalTerms;
  const excl = Array.isArray(p.standard_exclusions)
    ? p.standard_exclusions.map((s) => String(s ?? "").trim()).filter(Boolean)
    : [];
  return {
    who_we_are: p.who_we_are?.trim() || DEFAULT_PROFILE.who_we_are,
    why_fit: why.length ? why : DEFAULT_PROFILE.why_fit,
    next_steps: p.next_steps?.trim() || DEFAULT_PROFILE.next_steps,
    license_note: p.license_note?.trim() || DEFAULT_PROFILE.license_note,
    finish_note: p.finish_note?.trim() || DEFAULT_PROFILE.finish_note,
    closing: p.closing?.trim() || DEFAULT_PROFILE.closing,
    terms,
    // An explicitly saved list wins (even a shorter one); empty = defaults.
    standard_exclusions: excl.length ? excl : DEFAULT_EXCLUSIONS,
    references: cleanRefs(p.references),
    compliance: cleanCompliance(p.compliance),
  };
}
