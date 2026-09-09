/**
 * When a finger is allowed to put a point on the drawing.
 *
 * This is the rule that decides whether a touch is *drawing* or *navigating*,
 * and it has now been got wrong twice, so it lives here on its own with tests
 * instead of as a handful of refs spread through the viewer.
 *
 * The rule, in Erfan's words: while two fingers are on the screen nothing is
 * placed, and the next point needs a fresh touch that starts after every
 * finger is off the glass.
 *
 * Two things it has to survive:
 *
 * 1. **An incomplete finger census.** The viewer counts fingers in more than
 *    one place and each can miss one — a touch that lands on portalled UI
 *    never reaches the capture handler that feeds the main census. So the
 *    counts are OR'd and the gate trusts whichever says "more".
 *
 * 2. **The zoom committing asynchronously.** A pinch previews with a CSS
 *    transform and commits the real zoom on lift via setState. Until React
 *    re-renders, the page's measured rectangle is the NEW size while the
 *    scale number is still the OLD one, and screen→page conversion divides
 *    one by the other. A point placed in that window lands somewhere
 *    unrelated to the finger. That is what "random points" looked like.
 */

export type TouchGateState = {
  /** Fingers seen by the viewer-wide capture census: pointerId → landing time. */
  fingers: Map<number, number>;
  /**
   * Latched for the whole life of a multi-touch gesture; released only when
   * the last finger leaves. Deliberately NOT a timer — the old version was a
   * 250 ms cooldown, which is shorter than a re-render plus a PDF re-raster on
   * a phone, and which was never armed at all when the census missed a finger.
   */
  latched: boolean;
  /** Set when a pinch commits a new zoom; cleared once the re-render lands. */
  zoomSettling: boolean;
};

export function createTouchGate(): TouchGateState {
  return { fingers: new Map(), latched: false, zoomSettling: false };
}

/** A finger whose lift was never delivered is forgotten after this long. */
const STALE_MS = 6000;

/** Extra signals the viewer owns (its pinch bookkeeping). */
export type Surroundings = {
  /** Fingers tracked by the viewport for pinch maths. */
  pointerCount: number;
  /** A pinch is in progress. */
  pinching: boolean;
};

const NONE: Surroundings = { pointerCount: 0, pinching: false };

/** More than one finger down, according to any census. */
export function multiTouch(g: TouchGateState, s: Surroundings = NONE): boolean {
  return g.fingers.size > 1 || s.pointerCount > 1 || s.pinching;
}

/**
 * A finger landed. Returns true if this touch is part of a navigation
 * gesture, which is the viewer's cue to abandon whatever the first finger had
 * started and put any half-moved geometry back.
 */
export function fingerDown(
  g: TouchGateState,
  id: number,
  s: Surroundings = NONE,
  now = Date.now(),
): boolean {
  // A finger whose lift was never delivered (it happens) is forgotten, so a
  // lost event can't block drawing for the rest of the session.
  for (const [k, t] of g.fingers) if (now - t > STALE_MS) g.fingers.delete(k);
  g.fingers.set(id, now);
  if (multiTouch(g, s)) {
    g.latched = true;
    return true;
  }
  return false;
}

/** A finger lifted. The latch releases only when the glass is fully clear. */
export function fingerUp(
  g: TouchGateState,
  id: number,
  s: Surroundings = NONE,
): void {
  g.fingers.delete(id);
  if (g.fingers.size === 0 && s.pointerCount === 0) g.latched = false;
}

/**
 * This touch is part of a navigation gesture, so it starts nothing at all.
 * Checked when a finger lands.
 */
export function gestureBlocked(
  g: TouchGateState,
  s: Surroundings = NONE,
): boolean {
  return multiTouch(g, s) || g.latched;
}

/**
 * The point must not be committed. Checked when the finger lifts.
 *
 * Stricter than `gestureBlocked` by one condition: a tap that begins while the
 * zoom is still settling is allowed to START — swallowing it whole would feel
 * broken — but it is measured at lift, by which time the rectangle and the
 * scale agree again and the point lands where the finger actually was.
 */
export function placementBlocked(
  g: TouchGateState,
  s: Surroundings = NONE,
): boolean {
  return gestureBlocked(g, s) || g.zoomSettling;
}
