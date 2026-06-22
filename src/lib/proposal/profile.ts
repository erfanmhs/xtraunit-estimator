/**
 * Proposal profile — the company's standard, reusable proposal sections.
 *
 * These are the parts that read the same on every XtraUnit bid (Who We Are,
 * Why We're the Right Fit, Next Steps, the A-license note, the finish-package
 * note). The owner sets them up once (Settings → Proposal profile); the AI only
 * writes the project-specific parts. Stored as JSON on company_settings.
 *
 * Shared by the Settings editor (client) and the Proposal (server) — plain data,
 * no server-only imports.
 */

export type WhyBullet = { title: string; body: string };

export type ProposalProfile = {
  who_we_are: string;
  why_fit: WhyBullet[];
  next_steps: string;
  license_note: string;
  finish_note: string;
  closing: string;
};

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
};

/** Read a stored profile, filling any missing pieces from the defaults. */
export function resolveProfile(raw: unknown): ProposalProfile {
  const p = (raw ?? {}) as Partial<ProposalProfile>;
  const why =
    Array.isArray(p.why_fit) && p.why_fit.length
      ? p.why_fit.filter((b) => b && (b.title?.trim() || b.body?.trim()))
      : DEFAULT_PROFILE.why_fit;
  return {
    who_we_are: p.who_we_are?.trim() || DEFAULT_PROFILE.who_we_are,
    why_fit: why.length ? why : DEFAULT_PROFILE.why_fit,
    next_steps: p.next_steps?.trim() || DEFAULT_PROFILE.next_steps,
    license_note: p.license_note?.trim() || DEFAULT_PROFILE.license_note,
    finish_note: p.finish_note?.trim() || DEFAULT_PROFILE.finish_note,
    closing: p.closing?.trim() || DEFAULT_PROFILE.closing,
  };
}
