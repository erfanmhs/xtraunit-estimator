/**
 * The proposal document model — everything the proposal page needs, in one
 * plain JSON object.
 *
 * ONE builder (buildProposalDoc) turns the project's live data (scope lines,
 * pricing, markups, findings, the saved proposal fields, the company profile)
 * into a ProposalDoc. The owner's in-app page renders the live doc; "Publish"
 * freezes the same doc onto the proposal row, and the client's share link
 * renders that frozen copy — so what the client sees is exactly what was sent,
 * and the numbers can't drift underneath a signed acceptance.
 *
 * Shared by server (page, publish) and client (renderer) — no server imports.
 */
import type { ProposalProfile } from "./profile";
import { resolveContract, type ProposalContract } from "./contract";
// Relative on purpose: this file also runs under vitest, which has no "@/" alias.
import { groupByTrade } from "../scope/trades";

// ── Editable per-project pieces ─────────────────────────────────────────────

/** A tiered add-on the client can switch on. Base = the bid as priced. */
export type ProposalOption = {
  id: string;
  title: string;
  description: string;
  amount: number; // added to the base bid when selected
  tier: "recommended" | "enhanced";
  default_on: boolean;
};

export type Milestone = {
  label: string; // "Permits issued", "Framing complete"
  when: string; // "Week 2", "Mar 15", "3 weeks after start"
  depends_on: string; // "" or "Owner's finish selections by week 1"
};

export type ProposalTimeline = {
  start: string; // "Q2 2026", "Within 2 weeks of permit issuance"
  duration: string; // "18–21 months"
  milestones: Milestone[];
  // Client-side deliverables and outside dependencies on the critical path.
  assumptions: string[];
};

export const EMPTY_TIMELINE: ProposalTimeline = {
  start: "",
  duration: "",
  milestones: [],
  assumptions: [],
};

// ── The rendered document ───────────────────────────────────────────────────

export type CompanyInfo = {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_license: string | null;
  signer_name: string | null;
  signer_title: string | null;
  /** The company's look, frozen with the doc. Absent on docs published before branding existed. */
  branding?: { logo: string | null; primary: string; slogan: string; tagline: string };
};

export type ScopeRow = {
  id: string;
  /** What the client reads: the deliverable, or the CSI label for older lines. */
  description: string;
  /** One sentence under the headline — what the line covers. Absent on older lines. */
  detail?: string | null;
  /** The CSI section, as a small cost-code reference. */
  code?: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number; // 0 when unpriced
  priced: boolean;
};
/**
 * One heading in the client's scope. Since the trade-package layer
 * (SCOPE-WBS-DESIGN) this is a TRADE — Plumbing, Framing — not a CSI
 * division; the type keeps its name so proposals frozen before the change
 * still render.
 */
export type ScopeDivision = {
  code: string | null;
  name: string;
  total: number;
  rows: ScopeRow[];
};

export type CostBuckets = {
  labor: number;
  material: number;
  sub: number;
  equipment: number;
  other: number;
  unsplit: number; // lines priced as one total (can't be split into buckets)
};

export type ProposalDoc = {
  version: 1;
  company: CompanyInfo;
  profile: ProposalProfile;
  project: {
    name: string;
    client_name: string | null;
    address: string | null;
    project_type: string | null;
    building_sf: number | null;
  };
  client_name: string;
  proposal_date: string; // as shown
  valid_until: string | null; // ISO date
  executive_summary: string;
  project_description: string;
  understanding: string; // legacy "Our understanding" paragraph (optional)
  scope: {
    divisions: ScopeDivision[];
    excluded: string[]; // scope lines marked Excluded + exclusion findings
    assumptions: string[]; // assumption findings
  };
  pricing: {
    direct: number;
    buckets: CostBuckets;
    steps: { label: string; pct: number; amount: number }[];
    total: number; // the Base bid
    psf: number | null;
    unpriced: number; // active lines with no price (not in the number)
    options: ProposalOption[];
  };
  timeline: ProposalTimeline;
  /** The contract answers (dates, payments, notices on/off). Docs frozen before 0043 read as defaults. */
  contract: ProposalContract;
  published_at: string | null;
};

// ── Inputs the builder needs (kept generic so pages + publish share it) ────

export type LineInput = {
  id: string;
  division_code: string | null;
  division_name: string | null;
  section_code?: string | null;
  // The trade-package layer (migration 0041). Absent on older rows.
  trade_package?: string | null;
  deliverable?: string | null;
  includes?: string | null;
  excludes?: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  status: string | null;
  price_mode: string | null;
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
  price_status: string | null;
};

export type MarkupInput = {
  contingency_pct: number;
  insurance_pct: number;
  overhead_pct: number; // overhead & profit combined
};

export type ProposalFields = {
  client_name: string | null;
  proposal_date: string | null;
  valid_until: string | null;
  executive_summary: string | null;
  project_description: string | null;
  understanding: string | null;
  options: unknown;
  timeline: unknown;
  contract?: unknown;
  published_at: string | null;
};

// ── Math ────────────────────────────────────────────────────────────────────

export function lineAmount(li: LineInput): number {
  const mode = li.price_mode ?? "unit";
  if (mode === "total") return li.cost_total ?? 0;
  const sum =
    (li.cost_labor ?? 0) +
    (li.cost_material ?? 0) +
    (li.cost_sub ?? 0) +
    (li.cost_equipment ?? 0) +
    (li.cost_other ?? 0);
  if (mode === "lump") return sum;
  return (li.quantity ?? 0) * sum;
}

function isPriced(li: LineInput): boolean {
  return li.price_status === "proposed" || li.price_status === "confirmed";
}

export function cleanOptions(raw: unknown): ProposalOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o, i) => {
      const x = (o ?? {}) as Partial<ProposalOption>;
      return {
        id: String(x.id ?? `opt-${i}`),
        title: String(x.title ?? "").trim(),
        description: String(x.description ?? "").trim(),
        amount: Number.isFinite(Number(x.amount)) ? Number(x.amount) : 0,
        tier: x.tier === "enhanced" ? ("enhanced" as const) : ("recommended" as const),
        default_on: !!x.default_on,
      };
    })
    .filter((o) => o.title);
}

export function cleanTimeline(raw: unknown): ProposalTimeline {
  const t = (raw ?? {}) as Partial<ProposalTimeline>;
  return {
    start: String(t.start ?? "").trim(),
    duration: String(t.duration ?? "").trim(),
    milestones: Array.isArray(t.milestones)
      ? t.milestones
          .map((m) => {
            const x = (m ?? {}) as Partial<Milestone>;
            return {
              label: String(x.label ?? "").trim(),
              when: String(x.when ?? "").trim(),
              depends_on: String(x.depends_on ?? "").trim(),
            };
          })
          .filter((m) => m.label)
      : [],
    assumptions: Array.isArray(t.assumptions)
      ? t.assumptions.map((s) => String(s ?? "").trim()).filter(Boolean)
      : [],
  };
}

/** Base bid + the selected options. */
export function selectionTotal(doc: ProposalDoc, selected: Set<string>): number {
  return (
    doc.pricing.total +
    doc.pricing.options.filter((o) => selected.has(o.id)).reduce((a, o) => a + o.amount, 0)
  );
}

/** The three package totals: Base / Recommended / Enhanced. */
export function tierTotals(doc: ProposalDoc) {
  const rec = doc.pricing.options.filter((o) => o.tier === "recommended");
  const enh = doc.pricing.options.filter((o) => o.tier === "enhanced");
  const sum = (xs: ProposalOption[]) => xs.reduce((a, o) => a + o.amount, 0);
  return {
    base: doc.pricing.total,
    recommended: doc.pricing.total + sum(rec),
    enhanced: doc.pricing.total + sum(rec) + sum(enh),
    hasRecommended: rec.length > 0,
    hasEnhanced: enh.length > 0,
  };
}

export function tierSelection(doc: ProposalDoc, tier: "base" | "recommended" | "enhanced"): Set<string> {
  const s = new Set<string>();
  if (tier === "base") return s;
  for (const o of doc.pricing.options) {
    if (o.tier === "recommended" || tier === "enhanced") s.add(o.id);
  }
  return s;
}

export function defaultSelection(doc: ProposalDoc): Set<string> {
  return new Set(doc.pricing.options.filter((o) => o.default_on).map((o) => o.id));
}

/** ISO date + N days, as YYYY-MM-DD. */
export function plusDays(iso: string | Date, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ── The builder ─────────────────────────────────────────────────────────────

export function buildProposalDoc(input: {
  company: CompanyInfo;
  profile: ProposalProfile;
  project: ProposalDoc["project"];
  lines: LineInput[];
  markups: MarkupInput;
  findings: { kind: string; text: string }[];
  fields: ProposalFields;
}): ProposalDoc {
  const { company, profile, project, lines, markups, findings, fields } = input;

  const active = lines.filter((li) => li.status !== "excluded");
  const priced = active.filter(isPriced);

  // Scope by TRADE — every active line, priced or not (an unpriced line is
  // still scope; it just isn't in the number yet). A line drafted before the
  // trade layer existed is filed by its CSI section.
  const divisions: ScopeDivision[] = groupByTrade(active).map((g) => {
    const d: ScopeDivision = { code: null, name: g.trade, total: 0, rows: [] };
    for (const li of g.rows) {
      const p = isPriced(li);
      const amount = p ? lineAmount(li) : 0;
      d.rows.push({
        id: li.id,
        description: li.deliverable?.trim() || li.description,
        detail: li.includes?.trim() || null,
        code: li.section_code ?? null,
        quantity: li.quantity,
        unit: li.unit,
        amount,
        priced: p,
      });
      d.total += amount;
    }
    return d;
  });

  // Cost mix across the five buckets (+ lines priced as one total).
  const buckets: CostBuckets = { labor: 0, material: 0, sub: 0, equipment: 0, other: 0, unsplit: 0 };
  for (const li of priced) {
    const mode = li.price_mode ?? "unit";
    if (mode === "total") {
      buckets.unsplit += li.cost_total ?? 0;
      continue;
    }
    const mult = mode === "lump" ? 1 : (li.quantity ?? 0);
    buckets.labor += (li.cost_labor ?? 0) * mult;
    buckets.material += (li.cost_material ?? 0) * mult;
    buckets.sub += (li.cost_sub ?? 0) * mult;
    buckets.equipment += (li.cost_equipment ?? 0) * mult;
    buckets.other += (li.cost_other ?? 0) * mult;
  }

  const direct = priced.reduce((a, li) => a + lineAmount(li), 0);
  const steps: ProposalDoc["pricing"]["steps"] = [];
  let running = direct;
  for (const [k, label] of [
    ["contingency_pct", "Contingency"],
    ["insurance_pct", "Insurance"],
    ["overhead_pct", "Overhead & Profit"],
  ] as const) {
    const pct = markups[k];
    const amount = running * (pct / 100);
    running += amount;
    steps.push({ label, pct, amount });
  }
  const total = running;
  const sf = project.building_sf;

  // Excluded: whole lines the user excluded, what each active line says it
  // leaves out ("Plumbing — fixture supply by owner"), and exclusion findings.
  const excluded = [
    ...lines
      .filter((li) => li.status === "excluded")
      .map((li) => li.deliverable?.trim() || li.description),
    ...groupByTrade(active).flatMap((g) =>
      g.rows
        .filter((li) => li.excludes?.trim())
        .map((li) => `${g.trade} — ${li.excludes!.trim()}`),
    ),
    ...findings.filter((f) => f.kind === "exclusion").map((f) => f.text),
  ];
  const assumptions = findings.filter((f) => f.kind === "assumption").map((f) => f.text);

  const proposalDate =
    fields.proposal_date || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return {
    version: 1,
    company,
    profile,
    project,
    client_name: fields.client_name || project.client_name || "Owner",
    proposal_date: proposalDate,
    valid_until: fields.valid_until,
    executive_summary: fields.executive_summary ?? "",
    project_description: fields.project_description ?? "",
    understanding: fields.understanding ?? "",
    scope: { divisions, excluded, assumptions },
    pricing: {
      direct,
      buckets,
      steps,
      total,
      psf: sf && sf > 0 ? total / sf : null,
      unpriced: active.length - priced.length,
      options: cleanOptions(fields.options),
    },
    timeline: cleanTimeline(fields.timeline),
    contract: resolveContract(fields.contract, project.project_type),
    published_at: fields.published_at,
  };
}
