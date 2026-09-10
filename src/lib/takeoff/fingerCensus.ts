/**
 * The finger census that cannot miss a finger.
 *
 * Every earlier version of "two fingers means navigate, never draw" counted
 * fingers with POINTER events — on the drawing, on the viewer column, in the
 * viewport's pinch bookkeeping — and OR'd the counts. It still failed on the
 * phone (2026-09-10, sixth report): a second finger can land on a portalled
 * pill, arrive as a pointerdown the drawing sees before the column does, or
 * be swallowed by Safari when it decides the gesture is its own. Whichever
 * census missed it, the first finger's aim stayed alive, the rubber band
 * was left standing where the second finger touched, and the lift placed a
 * point there.
 *
 * Native TOUCH events carry the answer directly: `event.touches.length` is
 * the operating system's count of fingers on the page, delivered to a
 * document-level listener no matter which element a finger lands on, with
 * no capture to lose and no bubbling to miss. This module is the rule on
 * top of that count; the viewer feeds it from three document listeners and
 * asks it two questions.
 *
 * The rule, in Erfan's words: while two fingers are on the screen nothing
 * is placed, and the next point needs a fresh touch that starts after every
 * finger is off the glass.
 */

export type FingerCensus = {
  /** Fingers on the page after the latest touch event. */
  touches: number;
  /** A multi-touch gesture is in progress, or its cool-down has not passed. */
  navUntil: number;
  /** The tap in progress has been a single finger from the moment it began. */
  tapClean: boolean;
};

/** After the last finger of a pinch lifts, taps are ignored for this long. */
export const NAV_COOLDOWN_MS = 300;

export function createFingerCensus(): FingerCensus {
  return { touches: 0, navUntil: 0, tapClean: false };
}

/**
 * A touchstart or touchmove reported `count` fingers. Returns true the
 * moment a gesture becomes multi-touch — the viewer's cue to abandon
 * whatever the first finger had started (aim, drag, move, crop) and clear
 * the loupe and rubber band.
 */
export function touchesChanged(c: FingerCensus, count: number): boolean {
  const wasSingle = c.touches < 2;
  c.touches = count;
  if (count >= 2) {
    c.tapClean = false;
    c.navUntil = Infinity; // latched until every finger is off
    return wasSingle;
  }
  return false;
}

/** A touchend or touchcancel left `count` fingers on the page. */
export function touchesEnded(c: FingerCensus, count: number, now: number): void {
  c.touches = count;
  if (count === 0 && c.navUntil === Infinity) c.navUntil = now + NAV_COOLDOWN_MS;
}

/** A finger landing now must not start anything. */
export function blocked(c: FingerCensus, now: number): boolean {
  return c.touches >= 2 || now < c.navUntil;
}

/**
 * A draw-tool finger has landed. Remembers whether it was alone. (Pointer
 * events can arrive a hair before the touch event that raised the count, so
 * a second finger may briefly look clean here — the touchstart that follows
 * flips `tapClean` off within the same burst.)
 */
export function tapBegan(c: FingerCensus, now: number): void {
  c.tapClean = !blocked(c, now);
}

/** The finger lifted: may its point be placed? */
export function mayPlace(c: FingerCensus, now: number): boolean {
  return c.tapClean && c.touches <= 1 && now >= c.navUntil;
}
