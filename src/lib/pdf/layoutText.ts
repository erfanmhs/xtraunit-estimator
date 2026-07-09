/**
 * Layout-aware text extraction from PDF.js text items.
 *
 * The naive extraction (`items.map(i => i.str).join(" ")`) throws away every
 * item's POSITION, so a schedule/table — whose meaning lives entirely in its
 * rows and columns — collapses into one flat run of words. The AI then sees
 * "PILE SCHEDULE 18 24 40" with no idea which number belongs to which pile.
 *
 * This reconstructs the page: it groups items into rows by their y-position and,
 * within a row, inserts spacing proportional to the x-gaps — so columns stay
 * separated and rows stay on their own line. Tables survive as tables.
 *
 * Intentionally dependency-free and defensive (bad input → ""), so the caller
 * can fall back to the flat join if anything looks off.
 */

type PdfTextItem = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
};

type Glyph = { str: string; x: number; y: number; w: number; h: number };

export function layoutText(items: unknown[]): string {
  if (!Array.isArray(items)) return "";

  const glyphs: Glyph[] = [];
  for (const raw of items as PdfTextItem[]) {
    if (!raw || typeof raw.str !== "string" || raw.str.length === 0) continue;
    const t = raw.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const x = Number(t[4]);
    const y = Number(t[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = Number(raw.width) || 0;
    const h = Number(raw.height) || Math.abs(Number(t[3])) || 8;
    glyphs.push({ str: raw.str, x, y, w, h });
  }
  if (!glyphs.length) return "";

  // Representative glyph height → tolerances for grouping rows and detecting
  // column vs word gaps.
  const heights = glyphs
    .map((g) => g.h)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 8;
  const lineTol = medianH * 0.6; // same row if y within this
  const colGap = medianH * 1.2; // x-gap wider than this = a column break
  const wordGap = medianH * 0.25; // x-gap wider than this = a word space

  // Sort top-to-bottom (PDF y grows upward), then left-to-right, and cluster
  // into rows.
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Glyph[][] = [];
  for (const g of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - g.y) <= lineTol) row.push(g);
    else rows.push([g]);
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let prevRight: number | null = null;
    for (const g of row) {
      if (prevRight !== null) {
        const gap = g.x - prevRight;
        if (gap > colGap) {
          // A real column break — a run of spaces so the AI sees separate cells.
          const n = Math.min(8, Math.max(2, Math.round(gap / (medianH * 0.5))));
          line += " ".repeat(n);
        } else if (gap > wordGap) {
          line += " ";
        }
      }
      line += g.str;
      prevRight = g.x + g.w;
    }
    lines.push(line.replace(/\s+$/, ""));
  }

  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
