import { describe, expect, it } from "vitest";
import {
  NAV_COOLDOWN_MS,
  blocked,
  createFingerCensus,
  mayPlace,
  tapBegan,
  touchesChanged,
  touchesEnded,
} from "./fingerCensus";

describe("a clean single tap places", () => {
  it("down → lift with no other finger", () => {
    const c = createFingerCensus();
    touchesChanged(c, 1);
    tapBegan(c, 1000);
    touchesEnded(c, 0, 1200);
    expect(mayPlace(c, 1200)).toBe(true);
  });

  it("pointerdown a hair before its own touchstart still counts as clean", () => {
    const c = createFingerCensus();
    tapBegan(c, 1000); // pointer event first
    touchesChanged(c, 1); // then the touch event
    touchesEnded(c, 0, 1100);
    expect(mayPlace(c, 1100)).toBe(true);
  });
});

describe("a second finger during a tap", () => {
  it("abandons the tap, and reports the moment it became multi-touch once", () => {
    const c = createFingerCensus();
    touchesChanged(c, 1);
    tapBegan(c, 1000);
    expect(touchesChanged(c, 2)).toBe(true); // cue to cancel aim + clear rubber
    expect(touchesChanged(c, 2)).toBe(false); // touchmove with two: no new cue
    expect(mayPlace(c, 1300)).toBe(false);
  });

  it("the remaining finger of a pinch cannot place when it lifts", () => {
    const c = createFingerCensus();
    touchesChanged(c, 1);
    tapBegan(c, 1000);
    touchesChanged(c, 2);
    touchesEnded(c, 1, 1500); // first finger off, one still down
    expect(mayPlace(c, 1500)).toBe(false);
    // Even a pointerdown for the remaining finger is ignored.
    expect(blocked(c, 1500)).toBe(true);
    touchesEnded(c, 0, 1600);
    expect(mayPlace(c, 1600)).toBe(false); // tap was never clean
  });

  it("even when the second finger's pointerdown arrived before its touchstart", () => {
    const c = createFingerCensus();
    touchesChanged(c, 1);
    tapBegan(c, 1000);
    // Second finger: the drawing's pointerdown runs first and re-begins a tap…
    tapBegan(c, 1010);
    expect(c.tapClean).toBe(true); // …looks clean for an instant…
    touchesChanged(c, 2); // …until the OS count arrives in the same burst
    expect(c.tapClean).toBe(false);
    touchesEnded(c, 1, 1400);
    touchesEnded(c, 0, 1450);
    expect(mayPlace(c, 1450)).toBe(false);
  });
});

describe("after a pinch", () => {
  it("blocks new taps for the cool-down, then a fresh tap places", () => {
    const c = createFingerCensus();
    touchesChanged(c, 1);
    touchesChanged(c, 2);
    touchesEnded(c, 1, 2000);
    touchesEnded(c, 0, 2000);
    expect(blocked(c, 2000 + NAV_COOLDOWN_MS - 1)).toBe(true);
    expect(blocked(c, 2000 + NAV_COOLDOWN_MS)).toBe(false);
    // A fresh finger after the cool-down.
    touchesChanged(c, 1);
    tapBegan(c, 2500);
    touchesEnded(c, 0, 2600);
    expect(mayPlace(c, 2600)).toBe(true);
  });

  it("a tap that lands inside the cool-down is never placed, even if it lifts after it", () => {
    const c = createFingerCensus();
    touchesChanged(c, 2);
    touchesEnded(c, 0, 2000);
    touchesChanged(c, 1);
    tapBegan(c, 2100); // inside the cool-down
    touchesEnded(c, 0, 2800);
    expect(mayPlace(c, 2800)).toBe(false);
  });

  it("a missed touchstart is covered by the next touchmove's count", () => {
    const c = createFingerCensus();
    touchesChanged(c, 1);
    tapBegan(c, 1000);
    expect(touchesChanged(c, 2)).toBe(true); // arrived via touchmove
    expect(mayPlace(c, 1200)).toBe(false);
  });
});
