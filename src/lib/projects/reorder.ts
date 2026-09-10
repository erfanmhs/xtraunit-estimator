/**
 * The maths behind "hold a project, drag it somewhere else" (feedback A2/A3).
 *
 * Kept out of the component so it can be tested without a browser: the grid
 * itself is a CSS grid, so "where does the dragged card go" is a question
 * about rectangles, not about React.
 */

export type Rect = { left: number; top: number; width: number; height: number };

/** Move the item at `from` to `to`, shifting the others. Out-of-range or same index = unchanged copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Which slot is the finger over? The slot whose centre is nearest the point,
 * or `null` when the point is well outside every card (so a drag that wanders
 * off the grid leaves the order alone instead of snapping to the last card).
 */
export function slotAt(
  point: { x: number; y: number },
  rects: readonly Rect[],
  /** How far past a card's edge still counts as "over it", in px. */
  slack = 24,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const inside =
      point.x >= r.left - slack &&
      point.x <= r.left + r.width + slack &&
      point.y >= r.top - slack &&
      point.y <= r.top + r.height + slack;
    if (!inside) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(point.x - cx, point.y - cy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Same ids in the same order? (Cheap "did anything actually change" check before saving.) */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
