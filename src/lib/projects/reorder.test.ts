import { describe, expect, it } from "vitest";
import { moveItem, sameOrder, slotAt } from "./reorder";

describe("moveItem", () => {
  it("moves forward and backward, shifting the others", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("leaves the list alone for a no-op or a bad index, and never mutates", () => {
    const src = ["a", "b", "c"];
    expect(moveItem(src, 1, 1)).toEqual(src);
    expect(moveItem(src, -1, 1)).toEqual(src);
    expect(moveItem(src, 0, 9)).toEqual(src);
    expect(moveItem(src, 0, 2)).not.toBe(src);
    expect(src).toEqual(["a", "b", "c"]);
  });
});

describe("slotAt", () => {
  // A 2-column grid of 100×60 cards with a 10 px gap.
  const rects = [
    { left: 0, top: 0, width: 100, height: 60 },
    { left: 110, top: 0, width: 100, height: 60 },
    { left: 0, top: 70, width: 100, height: 60 },
    { left: 110, top: 70, width: 100, height: 60 },
  ];
  it("picks the card under the point", () => {
    expect(slotAt({ x: 50, y: 30 }, rects)).toBe(0);
    expect(slotAt({ x: 160, y: 100 }, rects)).toBe(3);
  });
  it("resolves the gap to the nearer card", () => {
    expect(slotAt({ x: 104, y: 30 }, rects)).toBe(0);
    expect(slotAt({ x: 107, y: 30 }, rects)).toBe(1);
  });
  it("returns null well outside the grid, but tolerates a little slack past an edge", () => {
    expect(slotAt({ x: 500, y: 500 }, rects)).toBeNull();
    expect(slotAt({ x: 220, y: 30 }, rects)).toBe(1); // 10 px past the right edge
    expect(slotAt({ x: 250, y: 30 }, rects)).toBeNull(); // 40 px past: not over anything
  });
});

describe("sameOrder", () => {
  it("compares ids positionally", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});
