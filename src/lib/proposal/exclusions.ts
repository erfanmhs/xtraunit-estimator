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

/**
 * `text` is the full line as it would print on its own ("Plumbing — gas
 * piping"); `short` is the part that reads under a trade heading ("gas
 * piping"), or the whole text where there is no trade.
 */
export type ExclusionItem =
  | { source: "line"; id: string; trade: string; text: string; short: string }
  | { source: "note"; id: string; trade: string; note: string; text: string; short: string }
  | { source: "finding"; id: string; text: string; short: string; hidden: boolean }
  | { source: "standard"; text: string; short: string; hidden: boolean };

/** How the list prints: by trade, then the plan review, then the standard list. */
export type ExclusionGroup = {
  kind: "trade" | "review" | "standard";
  title: string;
  items: ExclusionItem[];
};

export const REVIEW_GROUP_TITLE = "Noted while reading the plans";
export const STANDARD_GROUP_TITLE = "Standard on every proposal";

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
    if (li.status !== "excluded") continue;
    const name = li.deliverable?.trim() || li.description;
    out.push({ source: "line", id: li.id, trade: li.trade, text: li.trade ? `${li.trade} — ${name}` : name, short: name });
  }
  for (const li of input.lines) {
    const note = li.excludes?.trim();
    if (li.status !== "excluded" && note)
      out.push({ source: "note", id: li.id, trade: li.trade, note, text: li.trade ? `${li.trade} — ${note}` : note, short: note });
  }
  for (const f of input.findings) {
    if (f.kind !== "exclusion" || f.resolved) continue;
    out.push({ source: "finding", id: f.id ?? "", text: f.text, short: f.text, hidden: (f.status ?? "open") === "dismissed" });
  }
  for (const s of input.standard) {
    const t = s.trim();
    if (t) out.push({ source: "standard", text: t, short: t, hidden: hiddenSet.has(t) });
  }
  return out;
}

/**
 * Gathered the way the proposal prints them: one group per trade (in the
 * order the trades first appear — the scope's own order), then the plan
 * review's notes, then the standard list. Hidden items stay in their group
 * so the Scope page can show them greyed where they belong.
 */
export function groupExclusions(items: ExclusionItem[]): ExclusionGroup[] {
  const trades = new Map<string, ExclusionItem[]>();
  const review: ExclusionItem[] = [];
  const standard: ExclusionItem[] = [];
  for (const i of items) {
    if (i.source === "line" || i.source === "note") {
      const t = i.trade || "General";
      if (!trades.has(t)) trades.set(t, []);
      trades.get(t)!.push(i);
    } else if (i.source === "finding") review.push(i);
    else standard.push(i);
  }
  const out: ExclusionGroup[] = [];
  for (const [title, its] of trades) out.push({ kind: "trade", title, items: its });
  if (review.length) out.push({ kind: "review", title: REVIEW_GROUP_TITLE, items: review });
  if (standard.length) out.push({ kind: "standard", title: STANDARD_GROUP_TITLE, items: standard });
  return out;
}

/** The printed form: each group's title and the short texts the client reads (hidden ones left out). */
export function printedExclusionGroups(items: ExclusionItem[]): { title: string; items: string[] }[] {
  return groupExclusions(items)
    .map((g) => ({
      title: g.title,
      // Items are joined with "; " on the page, so their own trailing
      // period goes ("abatement.; New slab" read badly).
      items: g.items.filter((i) => !("hidden" in i) || !i.hidden).map((i) => i.short.replace(/[.;,\s]+$/, "")),
    }))
    .filter((g) => g.items.length);
}

/** The lines the client reads, in print order. */
export function shownExclusions(items: ExclusionItem[]): string[] {
  return items.filter((i) => !("hidden" in i) || !i.hidden).map((i) => i.text);
}

/** A stored hidden list, tolerating anything older or missing. */
export function resolveHidden(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((s) => String(s ?? "").trim()).filter(Boolean) : [];
}
