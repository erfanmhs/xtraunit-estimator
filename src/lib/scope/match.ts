/**
 * History matching — "just match", not exact match.
 * A new scope line matches a cost-database entry when:
 *   - same CSI division, AND
 *   - same unit (lf/ft treated alike; never mixes $/sf onto an each-count), AND
 *   - the descriptions share enough words (Jaccard similarity ≥ 0.5,
 *     with a bonus when the CSI section also matches).
 * Among candidates the highest score wins; ties go to the most recent entry
 * (callers pass history sorted newest-first).
 */

export type MatchableLine = {
  id: string;
  division_code: string | null;
  section_code: string | null;
  description: string;
  unit: string | null;
};

export type MatchableHistory = {
  division_code: string | null;
  section_code?: string | null;
  description: string;
  unit: string | null;
  created_at: string;
};

const UNIT_ALIASES: Record<string, string> = {
  lf: "ft",
  "lin ft": "ft",
  sqft: "sf",
  "sq ft": "sf",
  each: "ea",
};

function normUnit(u: string | null): string {
  const t = (u ?? "").trim().toLowerCase();
  return UNIT_ALIASES[t] ?? t;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9@."'/]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function findBestMatch<H extends MatchableHistory>(
  line: MatchableLine,
  history: H[],
): { row: H; score: number } | null {
  let best: { row: H; score: number } | null = null;
  for (const h of history) {
    if (!line.division_code || h.division_code !== line.division_code) continue;
    if (normUnit(h.unit) !== normUnit(line.unit)) continue;
    const sim = similarity(line.description, h.description);
    if (sim < 0.5) continue;
    const sectionBonus =
      line.section_code && h.section_code && line.section_code === h.section_code
        ? 0.15
        : 0;
    const score = sim + sectionBonus;
    // history is newest-first, so "greater than" keeps the most recent on ties.
    if (!best || score > best.score) best = { row: h, score };
  }
  return best;
}
