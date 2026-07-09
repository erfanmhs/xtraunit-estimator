/**
 * Detect sheets that carry a SCHEDULE or TABLE (pile schedule, door/window/
 * finish schedule, cut/fill earthwork quantities, column/beam/footing tables…).
 *
 * These are the sheets where the money numbers live in a grid — exactly what
 * gets scrambled by flat text extraction. When a sheet is detected as
 * table-bearing we (1) mark it "core" so scope routing can never hide it from
 * the trade that needs it, and (2) render it as a real high-res image for the
 * AI to read, not just its text.
 *
 * Isomorphic (no "server-only"): the browser ingest uses it to decide what to
 * render; the server bundle uses it to decide what's core.
 */

// Explicit schedule/table language, and the common quantity subjects.
const TABLE_MARKERS =
  /\bschedule\b|\btable\b|\bpile\b|\bpier\b|\bcaisson\b|\bearthwork\b|\bquantit(?:y|ies)\b|\b(?:cut|fill)\b[\s\S]{0,40}\b(?:fill|cut)\b|\b(?:door|window|finish|room|fixture|equipment|hardware|plumbing|lighting|column|beam|footing|slab|reinforc\w*)\s+schedule\b/i;

/**
 * True if the sheet's text looks like it contains a schedule/table. Uses keyword
 * markers plus a structural check: several rows that look tabular (≥3
 * space-separated columns with a number). Over-detection only costs an extra
 * image, never wrong data — so it leans inclusive.
 */
export function hasTableContent(text: string | null | undefined): boolean {
  if (!text) return false;
  if (TABLE_MARKERS.test(text)) return true;

  // Structural fallback (works because ingest now preserves column spacing):
  // count rows with ≥3 columns and at least one number.
  let tabularRows = 0;
  for (const line of text.split("\n")) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length >= 3 && /\d/.test(line)) tabularRows++;
    if (tabularRows >= 4) return true;
  }
  return false;
}
