/**
 * Takeoff geometry — the pure maths behind every measured quantity.
 *
 * These turn points on a drawing into the numbers that end up on the estimate,
 * so an error here is an error in a bid. They live outside the viewer
 * component precisely so they can be unit-tested (see geometry.test.ts).
 *
 * Coordinates are PDF points (72 per inch), zoom-independent. Scale comes in
 * as points-per-foot, separately for the horizontal and vertical axes, because
 * a sheet can be calibrated differently on each axis.
 */

export type Pt = { x: number; y: number };

/** Cubic feet in a cubic yard — concrete is ordered in yards. */
export const CF_PER_CY = 27;

/**
 * Layers group by trimmed name; anything unnamed shares the "Unlabeled" group.
 * Trimming matters: a phone keyboard happily appends a space, and "Footing "
 * must not become a second layer next to "Footing".
 */
export function layerKeyOf(layer: string | null): string {
  return (layer ?? "").trim() || "Unlabeled";
}

/** Straight-line distance between two points, in feet. */
export function segFeet(a: Pt, b: Pt, sx: number, sy: number): number {
  return Math.hypot((b.x - a.x) / sx, (b.y - a.y) / sy);
}

/** Total run length of a polyline, in feet. */
export function geomLenFeet(g: Pt[], sx: number, sy: number): number {
  let t = 0;
  for (let i = 1; i < g.length; i++) t += segFeet(g[i - 1], g[i], sx, sy);
  return t;
}

/**
 * Polygon area in square feet (shoelace formula), honouring separate H/V
 * scales. Winding direction doesn't matter — the result is always positive.
 */
export function polyAreaSqFt(g: Pt[], sx: number, sy: number): number {
  if (g.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < g.length; i++) {
    const p = g[i];
    const q = g[(i + 1) % g.length];
    a += (p.x / sx) * (q.y / sy) - (q.x / sx) * (p.y / sy);
  }
  return Math.abs(a) / 2;
}

/** Is the point inside the polygon? (ray casting) — used for hit testing. */
export function pointInPoly(p: Pt, g: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const a = g[i];
    const b = g[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to a line segment — used for hit testing. */
export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * A wall's billable area: run length × height, doubled when both faces are
 * finished (drywall on both sides of a stud wall).
 */
export function wallAreaSqFt(
  g: Pt[],
  sx: number,
  sy: number,
  height: number,
  sided: string | null,
): number {
  return geomLenFeet(g, sx, sy) * height * (sided === "double" ? 2 : 1);
}

/**
 * A volume in cubic feet. "area" mode is an area × depth (a slab); "linear"
 * mode is a run × width × depth (a footing or trench).
 */
export function volumeCuFt(
  g: Pt[],
  sx: number,
  sy: number,
  mode: string | null,
  width: number,
  depth: number,
): number {
  return mode === "area"
    ? polyAreaSqFt(g, sx, sy) * depth
    : geomLenFeet(g, sx, sy) * width * depth;
}
