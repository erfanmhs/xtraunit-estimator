/**
 * The drawing-vs-navigating rule. This has regressed twice on a real phone —
 * both times as points landing in random places mid-shape after a pinch — so
 * the gesture Erfan reported is written out here move by move.
 */
import { describe, expect, it } from "vitest";
import {
  createTouchGate,
  fingerDown,
  fingerUp,
  gestureBlocked,
  multiTouch,
  placementBlocked,
  type Surroundings,
} from "./touchGate";

/** The viewer's own pinch bookkeeping, which the gate reads but doesn't own. */
const viewport = (pointerCount: number, pinching = false): Surroundings => ({
  pointerCount,
  pinching,
});

describe("a single finger drawing", () => {
  it("lets a lone tap place a point", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    expect(gestureBlocked(g, viewport(1))).toBe(false);
    expect(placementBlocked(g, viewport(1))).toBe(false);
  });

  it("still allows the next point after a clean tap", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    fingerUp(g, 1, viewport(0));
    fingerDown(g, 2, viewport(1));
    expect(placementBlocked(g, viewport(1))).toBe(false);
  });
});

describe("the reported bug: pinching mid-shape", () => {
  it("places nothing while two fingers are down", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    const isGesture = fingerDown(g, 2, viewport(2));
    expect(isGesture).toBe(true); // the viewer abandons the aim on this
    expect(multiTouch(g, viewport(2))).toBe(true);
    expect(placementBlocked(g, viewport(2))).toBe(true);
  });

  it("stays blocked while the second finger is still down", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    fingerDown(g, 2, viewport(2));
    // One finger leaves; the pinch commits here, but a finger is still on the
    // glass. This is the exact moment the old 250 ms cooldown was armed from.
    fingerUp(g, 1, viewport(1));
    expect(g.latched).toBe(true);
    expect(placementBlocked(g, viewport(1))).toBe(true);
  });

  it("releases only once the last finger is gone, then allows a fresh point", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    fingerDown(g, 2, viewport(2));
    fingerUp(g, 1, viewport(1));
    fingerUp(g, 2, viewport(0));
    expect(g.latched).toBe(false);

    fingerDown(g, 3, viewport(1));
    expect(placementBlocked(g, viewport(1))).toBe(false);
  });

  it("never places a point across a whole pinch, however the fingers land", () => {
    // Every interleaving of two fingers going down and up. The gate must
    // refuse to place on either lift, in all of them.
    const orders: [number, number][] = [
      [1, 2],
      [2, 1],
    ];
    for (const [firstUp, secondUp] of orders) {
      const g = createTouchGate();
      fingerDown(g, 1, viewport(1));
      fingerDown(g, 2, viewport(2));
      fingerUp(g, firstUp, viewport(1));
      expect(placementBlocked(g, viewport(1))).toBe(true);
      fingerUp(g, secondUp, viewport(0));
      // The lift itself is still part of the gesture that just ended; the
      // viewer checks before removing the finger, so this is the state it sees.
      expect(g.fingers.size).toBe(0);
    }
  });
});

describe("censuses that disagree", () => {
  it("trusts the viewport when the capture census missed a finger", () => {
    // A touch on portalled UI never reaches the capture handler, so `fingers`
    // sees one finger while the viewport sees two. The stricter one wins.
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    expect(g.fingers.size).toBe(1);
    expect(multiTouch(g, viewport(2))).toBe(true);
    expect(placementBlocked(g, viewport(2))).toBe(true);
  });

  it("blocks while a pinch is in progress even if both counts look like one", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    expect(placementBlocked(g, viewport(1, true))).toBe(true);
  });

  it("keeps the latch while the viewport still has a finger", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1));
    fingerDown(g, 2, viewport(2));
    fingerUp(g, 1, viewport(1));
    fingerUp(g, 2, viewport(1)); // capture census clear, viewport is not
    expect(g.latched).toBe(true);
    expect(placementBlocked(g, viewport(1))).toBe(true);
  });
});

describe("the zoom settling after a pinch", () => {
  it("blocks a point until the new scale has actually rendered", () => {
    const g = createTouchGate();
    g.zoomSettling = true;
    fingerDown(g, 1, viewport(1));
    // The touch may START — swallowing it whole would feel broken…
    expect(gestureBlocked(g, viewport(1))).toBe(false);
    // …but it must not be committed while the rect and the scale disagree.
    expect(placementBlocked(g, viewport(1))).toBe(true);

    g.zoomSettling = false; // the re-render landed
    expect(placementBlocked(g, viewport(1))).toBe(false);
  });
});

describe("a finger whose lift never arrived", () => {
  it("is forgotten, so one lost event can't block drawing forever", () => {
    const g = createTouchGate();
    fingerDown(g, 1, viewport(1), 0); // lands at t=0, never lifts
    fingerDown(g, 2, viewport(1), 100); // 100 ms later — still counts as two
    expect(multiTouch(g, viewport(1))).toBe(true);

    const g2 = createTouchGate();
    fingerDown(g2, 1, viewport(1), 0);
    fingerDown(g2, 2, viewport(1), 7000); // 7 s later, the ghost is dropped
    expect(g2.fingers.size).toBe(1);
    expect(multiTouch(g2, viewport(1))).toBe(false);
  });
});
