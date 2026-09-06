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

export type WhyBullet = { title: string; body: string };

export type ProposalTerms = {
  change_orders: string;
  payment: string;
  schedule: string;
  force_majeure: string;
  disputes: string;
  insurance: string;
  warranty: string;
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
};

export const TERM_LABELS: Record<keyof ProposalTerms, string> = {
  change_orders: "Change orders",
  payment: "Payment terms",
  schedule: "Schedule",
  force_majeure: "Force majeure",
  disputes: "Dispute resolution",
  insurance: "Insurance & liability",
  warranty: "Warranty",
};

export const DEFAULT_TERMS: ProposalTerms = {
  change_orders:
    "Any change to the scope, materials, schedule, or site conditions after this proposal is priced as a written change order before the affected work proceeds. Concealed conditions found during the work (dry rot, unpermitted prior work, soil or utility surprises) are handled the same way. No change-order work starts without the owner's written approval, so the price never moves without a signature.",
  payment:
    "A deposit is due at signing as allowed by California law. Progress payments are invoiced monthly against work in place and are due within 10 days of the invoice. Retention of 5% is released with the final payment at completion. Late payments accrue interest at 1.5% per month.",
  schedule:
    "The timeline starts when the deposit is received, permits are issued, and the site is available. Dates listed as dependencies (permit issuance, owner selections, site access) are on the critical path — a delay there moves the finish date day for day.",
  force_majeure:
    "Neither party is responsible for delays caused by events beyond its reasonable control: severe weather, fire, strikes, material shortages, pandemic restrictions, or government action. The schedule extends by the length of the delay; any cost impact is handled by change order.",
  disputes:
    "We resolve disagreements by direct discussion first, then mediation in Los Angeles County. Anything still unresolved goes to binding arbitration under California law, and the prevailing party recovers reasonable attorney's fees.",
  insurance:
    "XtraUnit carries general liability and workers' compensation insurance and is licensed and bonded (CA LIC #1033830). Certificates are provided on request. The owner maintains property and builder's-risk coverage on the structure.",
  warranty:
    "Workmanship is warranted for one year from substantial completion. Manufacturer warranties on materials, fixtures, and equipment pass through to the owner.",
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
};

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
  };
}
