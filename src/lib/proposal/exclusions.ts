/**
 * The "Excluded / by others" list of a proposal — ONE place that decides
 * what the client reads, so the Scope page can show the very same list and
 * let the estimator edit, restore or delete each item (Erfan, 2026-09-14).
 *
 * Four sources, in the order the proposal prints them:
 *   1. whole scope lines marked Excluded             → text = the line
 *   2. what an active line says it leaves out        → "Trade — …"
 *   3. the AI's exclusion findings (not dismissed)   → the finding's text
 *   4. the company's standard exclusions (Settings)  → minus the ones hidden
 *                                                      on this project
 *
 * Pure: no React, no Supabase.
 */

export type ExclusionLine = {
  id: string;
  status: string | null;
  deliverable?: string | null;
  description: string;
  excludes?: string | null;
  trade: string;
};

export type ExclusionFinding = {
  id?: string;
  kind: string;
  text: string;
  status?: string | null;
  resolved?: boolean | null;
};

export type ExclusionItem =
  | { source: "line"; id: string; text: string }
  | { source: "note"; id: string; trade: string; note: string; text: string }
  | { source: "finding"; id: string; text: string; hidden: boolean }
  | { source: "standard"; text: string; hidden: boolean };

/** Every candidate, hidden ones included (the Scope page shows those greyed, with Restore). */
export function exclusionItems(input: {
  lines: ExclusionLine[];
  findings: ExclusionFinding[];
  standard: string[];
  hidden: string[];
}): ExclusionItem[] {
  const hiddenSet = new Set(input.hidden.map((s) => s.trim()));
  const out: ExclusionItem[] = [];
  for (const li of input.lines) {
    if (li.status === "excluded") out.push({ source: "line", id: li.id, text: li.deliverable?.trim() || li.description });
  }
  for (const li of input.lines) {
    const note = li.excludes?.trim();
    if (li.status !== "excluded" && note) out.push({ source: "note", id: li.id, trade: li.trade, note, text: `${li.trade} — ${note}` });
  }
  for (const f of input.findings) {
    if (f.kind !== "exclusion" || f.resolved) continue;
    out.push({ source: "finding", id: f.id ?? "", text: f.text, hidden: (f.status ?? "open") === "dismissed" });
  }
  for (const s of input.standard) {
    const t = s.trim();
    if (t) out.push({ source: "standard", text: t, hidden: hiddenSet.has(t) });
  }
  return out;
}

/** The lines the client reads, in print order. */
export function shownExclusions(items: ExclusionItem[]): string[] {
  return items.filter((i) => !("hidden" in i) || !i.hidden).map((i) => i.text);
}

/** A stored hidden list, tolerating anything older or missing. */
export function resolveHidden(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((s) => String(s ?? "").trim()).filter(Boolean) : [];
}
