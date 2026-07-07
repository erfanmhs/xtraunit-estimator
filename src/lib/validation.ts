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
});

// startScope — the selected trades (from the Generate panel); bounded for safety.
export const tradesInput = z.array(z.string().max(80)).max(50);
