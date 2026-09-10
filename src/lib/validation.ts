import "server-only";

/**
 * Input validation schemas for server actions.
 *
 * The database (RLS + column types) is the last line of defense, but that
 * rejects bad input with an ugly low-level error AFTER a round-trip. Validating
 * at the top of a server action catches malformed or oversized input early and
 * turns it into a friendly message — and bounds text length so nobody can post
 * a megabyte of "notes".
 *
 * Pattern: `const parsed = schema.safeParse(input)` → on `!parsed.success`,
 * surface `parsed.error.issues[0]?.message`; otherwise use `parsed.data`.
 * This file establishes the layer; extend it action-by-action.
 */
import { z } from "zod";

// Reusable field bounds.
export const shortText = z.string().trim().max(200);
export const longText = z.string().trim().max(10_000);

// Project types offered by the New Project form (keep in sync with the <select>).
export const PROJECT_TYPES = [
  "multifamily",
  "adu_addition",
  "residential",
  "commercial",
  "trade_work",
  "other",
] as const;

// createProject — raw form values (empties already coerced to null by caller).
export const projectInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please give the project a name.")
    .max(200, "That project name is too long."),
  client_name: shortText.nullable(),
  address: shortText.nullable(),
  project_type: z.enum(PROJECT_TYPES).nullable(),
  notes: longText.nullable(),
});

// reorderProjects — the user's whole list, top to bottom.
export const projectOrder = z.array(z.string().uuid()).min(1).max(500);

// updateLineItem — a partial patch; every field optional, but bounded when present.
export const lineItemPatch = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Description can't be empty.")
    .max(2_000)
    .optional(),
  quantity: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
  // The trade-package layer (migration 0041).
  trade_package: z.string().trim().max(120).nullable().optional(),
  deliverable: z.string().trim().max(300).nullable().optional(),
  includes: z.string().trim().max(2_000).nullable().optional(),
  excludes: z.string().trim().max(2_000).nullable().optional(),
});

// startScope — the selected trades (from the Generate panel); bounded for safety.
export const tradesInput = z.array(z.string().max(80)).max(50);

// ── Broader coverage (audit layer 8) ─────────────────────────────────────────
// Every server action that writes user-typed data checks its input here first.

/** A row id — every action that targets a row by id checks it's a real UUID. */
export const uuid = z.string().uuid("That item id isn't valid.");

/** A money amount: finite, never negative, and not absurd (a billion dollars). */
export const money = z.number().finite().min(0).max(1_000_000_000);
export const percent = z.number().finite().min(0).max(100);
const divisionCode = z.string().trim().regex(/^\d{2}$/, "Division codes are two digits.");

// Scope canvas — add a line by hand.
export const newLineItem = z.object({
  division_code: z.string().trim().max(10).nullable(),
  division_name: z.string().trim().max(200).nullable(),
  trade_package: z.string().trim().max(120).nullable().optional(),
  deliverable: z.string().trim().max(300).nullable().optional(),
  includes: z.string().trim().max(2_000).nullable().optional(),
  excludes: z.string().trim().max(2_000).nullable().optional(),
  description: z.string().trim().min(1, "Description can't be empty.").max(2_000),
  quantity: z.number().finite().nullable(),
  unit: z.string().trim().max(50).nullable(),
});
export const lineStatus = z.enum(["proposed", "confirmed", "excluded"]);

// Findings — an answer/note, a decision, a sheet category.
export const findingAnswer = z.string().max(5_000);
export const findingStatus = z.enum(["open", "accepted", "dismissed"]);
export const disciplineInput = z.string().trim().max(60);

// Pricing — the five buckets or one total, per line.
export const pricePatch = z.object({
  price_mode: z.enum(["unit", "lump", "total"]).optional(),
  cost_labor: money.nullable().optional(),
  cost_material: money.nullable().optional(),
  cost_sub: money.nullable().optional(),
  cost_equipment: money.nullable().optional(),
  cost_other: money.nullable().optional(),
  cost_total: money.nullable().optional(),
  price_source: z.string().trim().max(40).nullable().optional(),
  price_note: z.string().trim().max(500).nullable().optional(),
});

// Sub quotes — the trade partner's lump sum being applied.
export const subQuoteInput = z.object({
  sub_name: z.string().trim().min(1, "Sub name is required.").max(200),
  trade: z.string().trim().max(100).nullable(),
  division_codes: z.array(divisionCode).min(1, "Pick at least one division the quote covers.").max(40),
  quote_date: z.string().trim().max(40).nullable(),
  total: money.positive("Quote total must be a positive number."),
  notes: longText.nullable(),
  file_path: z.string().max(500).nullable(),
  file_name: z.string().max(300).nullable(),
  extracted: z.unknown().nullable(),
});

// Estimate — markups.
export const markupsInput = z.object({
  contingency_pct: percent,
  insurance_pct: percent,
  overhead_pct: percent,
  profit_pct: percent,
});
export const buildingSfInput = z.number().finite().min(0).max(100_000_000).nullable().optional();

// Settings — company identity + default markups.
export const companySettingsInput = z.object({
  company_name: shortText.nullable(),
  company_address: z.string().trim().max(300).nullable(),
  company_phone: z.string().trim().max(40).nullable(),
  company_email: z.string().trim().max(200).nullable(),
  company_license: shortText.nullable(),
  signer_name: shortText.nullable(),
  signer_title: shortText.nullable(),
  default_contingency_pct: percent,
  default_insurance_pct: percent,
  default_op_pct: percent,
});

// Cost database — edits to history entries and the items catalog.
export const costEntryPatch = z.object({
  description: z.string().trim().min(1, "Description can't be empty.").max(2_000).optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  price_mode: z.enum(["unit", "lump", "total"]).optional(),
  cost_labor: money.nullable().optional(),
  cost_material: money.nullable().optional(),
  cost_sub: money.nullable().optional(),
  cost_equipment: money.nullable().optional(),
  cost_other: money.nullable().optional(),
  cost_total: money.nullable().optional(),
  price_note: z.string().trim().max(500).nullable().optional(),
});
export const itemOverride = money.nullable();
export const itemRename = z.object({
  name: z.string().trim().min(1, "Name can't be empty.").max(200),
  unit: z.string().trim().max(50).nullable(),
});
export const benchmarksInput = z
  .array(
    z.object({
      label: z.string().trim().max(100),
      sell_low: money.nullable(),
      sell_high: money.nullable(),
    }),
  )
  .max(50);

/** The first problem as a friendly sentence. */
export function firstIssue(err: z.ZodError, fallback = "That input wasn't valid."): string {
  return err.issues[0]?.message ?? fallback;
}
