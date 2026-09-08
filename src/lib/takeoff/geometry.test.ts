/**
 * Takeoff geometry — these numbers become quantities on a bid, so they are
 * checked against hand-worked examples, not against the implementation.
 *
 * The scale used throughout is 18 points per foot, which is 1/4" = 1'-0" (a
 * quarter inch is 18 points), the most common architectural scale and the one
 * on the real sheets.
 */
import { describe, expect, it } from "vitest";
import {
  CF_PER_CY,
  distToSeg,
  geomLenFeet,
  layerKeyOf,
  pointInPoly,
  polyAreaSqFt,
  segFeet,
  volumeCuFt,
  wallAreaSqFt,
} from "./geometry";

const S = 18; // points per foot at 1/4" = 1'

describe("segFeet", () => {
  it("converts a horizontal run to feet", () => {
    expect(segFeet({ x: 0, y: 0 }, { x: 180, y: 0 }, S, S)).toBe(10);
  });

  it("is direction-independent", () => {
    const a = { x: 40, y: 90 };
    const b = { x: 220, y: 10 };
    expect(segFeet(a, b, S, S)).toBeCloseTo(segFeet(b, a, S, S), 10);
  });

  it("honours different horizontal and vertical scales", () => {
    // 180 pt across at 18 pt/ft = 10 ft; 180 pt down at 9 pt/ft = 20 ft.
    expect(segFeet({ x: 0, y: 0 }, { x: 180, y: 0 }, 18, 9)).toBe(10);
    expect(segFeet({ x: 0, y: 0 }, { x: 0, y: 180 }, 18, 9)).toBe(20);
  });

  it("measures a 3-4-5 triangle's hypotenuse", () => {
    expect(segFeet({ x: 0, y: 0 }, { x: 3 * S, y: 4 * S }, S, S)).toBeCloseTo(5, 10);
  });
});

describe("geomLenFeet", () => {
  it("sums every segment of a run", () => {
    const g = [
      { x: 0, y: 0 },
      { x: 180, y: 0 }, // 10 ft
      { x: 180, y: 90 }, // 5 ft
      { x: 0, y: 90 }, // 10 ft
    ];
    expect(geomLenFeet(g, S, S)).toBeCloseTo(25, 10);
  });

  it("does NOT close the loop — an open run stays open", () => {
    // Four corners of a 10x10 box: three sides drawn = 30 ft, not 40.
    const g = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 180 },
      { x: 0, y: 180 },
    ];
    expect(geomLenFeet(g, S, S)).toBeCloseTo(30, 10);
  });

  it("is zero for fewer than two points", () => {
    expect(geomLenFeet([], S, S)).toBe(0);
    expect(geomLenFeet([{ x: 5, y: 5 }], S, S)).toBe(0);
  });
});

describe("polyAreaSqFt", () => {
  const square10 = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 180 },
    { x: 0, y: 180 },
  ];

  it("measures a 10 ft square as 100 sf", () => {
    expect(polyAreaSqFt(square10, S, S)).toBeCloseTo(100, 10);
  });

  it("gives the same answer whichever way the shape was drawn", () => {
    expect(polyAreaSqFt([...square10].reverse(), S, S)).toBeCloseTo(100, 10);
  });

  it("measures a triangle as half its bounding box", () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 0, y: 180 },
    ];
    expect(polyAreaSqFt(tri, S, S)).toBeCloseTo(50, 10);
  });

  it("handles an L-shaped room", () => {
    // 10x10 square with a 5x5 bite taken out of one corner = 75 sf.
    const l = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 90 },
      { x: 90, y: 90 },
      { x: 90, y: 180 },
      { x: 0, y: 180 },
    ];
    expect(polyAreaSqFt(l, S, S)).toBeCloseTo(75, 10);
  });

  it("is zero for a shape that can't enclose anything", () => {
    expect(polyAreaSqFt([], S, S)).toBe(0);
    expect(polyAreaSqFt([{ x: 0, y: 0 }, { x: 10, y: 10 }], S, S)).toBe(0);
  });
});

describe("wallAreaSqFt", () => {
  const run = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
  ]; // 10 ft

  it("is length x height for a single-sided wall", () => {
    expect(wallAreaSqFt(run, S, S, 8, "single")).toBeCloseTo(80, 10);
  });

  it("doubles for a wall finished on both faces", () => {
    expect(wallAreaSqFt(run, S, S, 8, "double")).toBeCloseTo(160, 10);
  });

  it("treats an unset side as single", () => {
    expect(wallAreaSqFt(run, S, S, 8, null)).toBeCloseTo(80, 10);
  });
});

describe("volumeCuFt", () => {
  it("area mode is area x depth (a slab)", () => {
    const slab = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 180 },
      { x: 0, y: 180 },
    ]; // 100 sf
    // 100 sf x 4 in (0.333 ft) = 33.3 cf
    expect(volumeCuFt(slab, S, S, "area", 0, 1 / 3)).toBeCloseTo(100 / 3, 8);
  });

  it("linear mode is length x width x depth (a footing)", () => {
    const run = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
    ]; // 10 ft
    expect(volumeCuFt(run, S, S, "linear", 1.5, 2)).toBeCloseTo(30, 10);
  });

  it("27 cubic feet make a cubic yard", () => {
    const run = [
      { x: 0, y: 0 },
      { x: 27 * S, y: 0 },
    ]; // 27 ft
    const cf = volumeCuFt(run, S, S, "linear", 1, 1); // 27 cf
    expect(cf / CF_PER_CY).toBeCloseTo(1, 10);
  });
});

describe("pointInPoly", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("finds a point inside", () => {
    expect(pointInPoly({ x: 50, y: 50 }, square)).toBe(true);
  });

  it("rejects a point outside", () => {
    expect(pointInPoly({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPoly({ x: -1, y: 50 }, square)).toBe(false);
  });

  it("rejects everything for a degenerate shape", () => {
    expect(pointInPoly({ x: 1, y: 1 }, [])).toBe(false);
  });
});

describe("distToSeg", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it("measures perpendicular distance to the middle of a segment", () => {
    expect(distToSeg({ x: 50, y: 25 }, a, b)).toBeCloseTo(25, 10);
  });

  it("clamps past the ends instead of using the infinite line", () => {
    // Straight out beyond b: the nearest point is b itself, 30 away.
    expect(distToSeg({ x: 130, y: 0 }, a, b)).toBeCloseTo(30, 10);
  });

  it("is zero on the segment", () => {
    expect(distToSeg({ x: 40, y: 0 }, a, b)).toBeCloseTo(0, 10);
  });

  it("handles a zero-length segment without dividing by zero", () => {
    const d = distToSeg({ x: 3, y: 4 }, a, a);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(5, 10);
  });
});

describe("layerKeyOf", () => {
  it("groups by trimmed name", () => {
    // The iOS keyboard appends spaces; "Footing " must not become a 2nd layer.
    expect(layerKeyOf("Footing ")).toBe("Footing");
    expect(layerKeyOf("  Footing")).toBe("Footing");
    expect(layerKeyOf("Footing")).toBe(layerKeyOf("Footing "));
  });

  it("falls back to Unlabeled", () => {
    expect(layerKeyOf(null)).toBe("Unlabeled");
    expect(layerKeyOf("")).toBe("Unlabeled");
    expect(layerKeyOf("   ")).toBe("Unlabeled");
  });
});
