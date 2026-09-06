/**
 * Detail-callout parsing — the free, deterministic cross-reference map.
 *
 * A construction plan points at its details with callouts like "5/S4.1"
 * (detail 5, on sheet S4.1). Finding these in the extracted text — no AI — lets
 * us (1) guarantee every REFERENCED detail sheet reaches the AI, and (2) hand
 * the AI the map so it knows what to look up. It's the cheap foundation the
 * paid, targeted detail-reading rides on. See docs/ai-drawing-reading-research.md
 * (structured parse + retrieval is the #1 cross-sheet win).
 *
 * Isomorphic (no "server-only") so both the server bundle and, later, the
 * browser ingest can use it.
 */

export type Callout = { detail: string; sheet: string }; // e.g. { detail:"5", sheet:"S4.1" }

// "5/S4.1", "3 / A-501", "A/S4.1", "12/S-2" — a short detail id, a slash, and a
// sheet number that STARTS WITH A DISCIPLINE LETTER (so plain fractions like
// "3/4" or "1/2" don't match).
const CALLOUT_RE =
  /\b([A-Za-z]?\d{1,2}|[A-Za-z])\s*\/\s*([A-Za-z]{1,3}[-–.]?\s?\d{1,3}(?:\.\d{1,2})?)\b/g;

/** Normalize a sheet number for matching: uppercase, drop spaces/hyphens, keep dots. */
export function normalizeSheetNumber(
  name: string | null | undefined,
  label?: string | null,
): string | null {
  for (const raw of [name, label]) {
    const s = (raw ?? "").trim();
    // Leading token that looks like a sheet number: letters then digits.
    const m = s.match(/^([A-Za-z]{1,3})[-–.\s]?\s?(\d{1,3}(?:\.\d{1,2})?)/);
    if (m) return `${m[1].toUpperCase()}${m[2]}`;
  }
  return null;
}

function normSheetRef(sheet: string): string {
  return sheet.toUpperCase().replace(/[\s\-–]/g, "");
}

/** Find detail callouts in a sheet's text. Deduped, normalized. */
export function extractCallouts(text: string | null | undefined): Callout[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: Callout[] = [];
  for (const m of text.matchAll(CALLOUT_RE)) {
    const detail = m[1].toUpperCase().replace(/\s/g, "");
    const sheet = normSheetRef(m[2]);
    const key = `${detail}/${sheet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ detail, sheet });
  }
  return out;
}

export type CrossRefIndex = {
  callouts: Callout[]; // every distinct callout across the set
  targetSheetNumbers: Set<string>; // normalized sheet numbers that are pointed at
};

/**
 * Build the project-wide cross-reference index from each sheet's text +
 * identity. Returns the distinct callouts and the set of sheet numbers they
 * point at (so those sheets can be forced into the AI's context).
 */
export function buildCrossRefIndex(
  sheets: { name: string | null; label: string | null; text: string }[],
): CrossRefIndex {
  const seen = new Set<string>();
  const callouts: Callout[] = [];
  const targetSheetNumbers = new Set<string>();
  for (const s of sheets) {
    for (const c of extractCallouts(s.text)) {
      const key = `${c.detail}/${c.sheet}`;
      if (!seen.has(key)) {
        seen.add(key);
        callouts.push(c);
      }
      targetSheetNumbers.add(c.sheet);
    }
  }
  return { callouts, targetSheetNumbers };
}

/**
 * A short prompt block listing the callouts and (where found) the sheet each
 * resolves to, so the AI reads the right detail when scoping the related work.
 * Capped so it never bloats the prompt.
 */
export function crossRefPromptText(
  index: CrossRefIndex,
  sheets: { name: string | null; label: string | null; page_number: number }[],
): string {
  if (!index.callouts.length) return "";
  const bySheetNum = new Map<string, string>();
  for (const s of sheets) {
    const num = normalizeSheetNumber(s.name, s.label);
    if (num && !bySheetNum.has(num))
      bySheetNum.set(
        num,
        `${s.name || `Sheet ${s.page_number}`}${s.label ? ` (${s.label})` : ""}`,
      );
  }
  const lines = index.callouts.slice(0, 50).map((c) => {
    const target = bySheetNum.get(c.sheet);
    return `  - detail ${c.detail} on ${c.sheet}${target ? ` → ${target}` : " (that sheet isn't in this set)"}`;
  });
  return [
    "PLAN CROSS-REFERENCES (detail callouts the app found on the drawings). When you scope the related work, READ the referenced detail on its sheet for the rebar, dimensions, materials and assemblies:",
    ...lines,
  ].join("\n");
}
