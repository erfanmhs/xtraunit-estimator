/**
 * Per-layer totals and re-scaling. These feed the side panel, the on-sheet
 * legend, the PDF export and ultimately the scope, so the sums have to be
 * right and units must never be added together.
 */
import { describe, expect, it } from "vitest";
import {
  buildLayerGroups,
  labelText,
  recomputeValue,
  type MeasurementLike,
} from "./measurements";

const S = 18; // 1/4" = 1'

function m(over: Partial<MeasurementLike> = {}): MeasurementLike {
  return {
    type: "line",
    geometry: [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
    ], // 10 ft
    value: null,
    unit: "ft",
    layer: null,
    ...over,
  };
}

describe("recomputeValue", () => {
  it("re-measures a line at the new scale", () => {
    expect(recomputeValue(m({ type: "line" }), S, S)).toBeCloseTo(10, 10);
    // Same drawing, scale halved (36 pt/ft) → half the feet.
    expect(recomputeValue(m({ type: "line" }), 36, 36)).toBeCloseTo(5, 10);
  });

  it("re-measures an area", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 180 },
      { x: 0, y: 180 },
    ];
    expect(recomputeValue(m({ type: "area", geometry: square }), S, S)).toBeCloseTo(100, 10);
  });

  it("re-measures a wall, honouring height and sides", () => {
    expect(
      recomputeValue(m({ type: "wall", wall_height: 8, wall_sided: "single" }), S, S),
    ).toBeCloseTo(80, 10);
    expect(
      recomputeValue(m({ type: "wall", wall_height: 8, wall_sided: "double" }), S, S),
    ).toBeCloseTo(160, 10);
  });

  it("re-measures both kinds of volume", () => {
    expect(
      recomputeValue(m({ type: "volume", vol_mode: "linear", vol_width: 1.5, vol_depth: 2 }), S, S),
    ).toBeCloseTo(30, 10);
    const square = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 180 },
      { x: 0, y: 180 },
    ];
    expect(
      recomputeValue(m({ type: "volume", geometry: square, vol_mode: "area", vol_depth: 0.5 }), S, S),
    ).toBeCloseTo(50, 10);
  });

  it("leaves a count alone — a tally is not a distance", () => {
    expect(recomputeValue(m({ type: "count", value: 15 }), S, S)).toBe(15);
    expect(recomputeValue(m({ type: "count", value: 15 }), 999, 999)).toBe(15);
  });

  it("leaves an unmeasured type alone", () => {
    expect(recomputeValue(m({ type: "leader", value: null }), S, S)).toBeNull();
  });

  it("treats a missing wall height as zero rather than NaN", () => {
    const v = recomputeValue(m({ type: "wall", wall_height: null }), S, S);
    expect(v).toBe(0);
    expect(Number.isNaN(v)).toBe(false);
  });
});

describe("labelText", () => {
  it("shows one decimal and the unit", () => {
    expect(labelText(m({ value: 412.46, unit: "sf" }))).toBe("412.5 sf");
  });

  it("shows cubic yards alongside cubic feet, for ordering concrete", () => {
    expect(labelText(m({ type: "volume", value: 54, unit: "cf" }))).toBe("54 cf · 2.00 cy");
  });

  it("shows a count as a whole number", () => {
    expect(labelText(m({ type: "count", value: 11, unit: "ea" }))).toBe("11 ea");
  });

  it("is empty when there is no value", () => {
    expect(labelText(m({ value: null }))).toBe("");
  });
});

describe("buildLayerGroups", () => {
  it("sums runs within a layer", () => {
    const g = buildLayerGroups([
      m({ layer: "Interior wall", value: 100, unit: "sf" }),
      m({ layer: "Interior wall", value: 50.5, unit: "sf" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].rows).toHaveLength(2);
    expect(g[0].lines).toEqual(["150.5 sf"]);
  });

  it("groups by trimmed name, so a stray keyboard space doesn't split a layer", () => {
    const g = buildLayerGroups([
      m({ layer: "Footing", value: 10, unit: "lf" }),
      m({ layer: "Footing ", value: 5, unit: "lf" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].layer).toBe("Footing");
    expect(g[0].lines).toEqual(["15.0 lf"]);
  });

  it("keeps different units apart instead of adding them", () => {
    const g = buildLayerGroups([
      m({ layer: "Mixed", value: 100, unit: "sf" }),
      m({ layer: "Mixed", value: 3, unit: "ea" }),
    ]);
    expect(g[0].lines).toHaveLength(2);
    expect(g[0].lines).toContain("100.0 sf");
    expect(g[0].lines).toContain("3 ea");
  });

  it("converts a layer's cubic feet to yards", () => {
    const g = buildLayerGroups([
      m({ layer: "Slab", value: 27, unit: "cf" }),
      m({ layer: "Slab", value: 27, unit: "cf" }),
    ]);
    expect(g[0].lines).toEqual(["54 cf · 2.00 cy"]);
  });

  it("puts unnamed runs in Unlabeled", () => {
    const g = buildLayerGroups([m({ layer: null, value: 1, unit: "ea" })]);
    expect(g[0].layer).toBe("Unlabeled");
  });

  it("ignores runs with no value when totalling, but still lists them", () => {
    const g = buildLayerGroups([
      m({ layer: "L", value: 10, unit: "sf" }),
      m({ layer: "L", value: null, unit: null, type: "leader" }),
    ]);
    expect(g[0].rows).toHaveLength(2);
    expect(g[0].lines).toEqual(["10.0 sf"]);
  });

  it("keeps first-seen order so the panel doesn't reshuffle while drawing", () => {
    const g = buildLayerGroups([
      m({ layer: "B", value: 1, unit: "ea" }),
      m({ layer: "A", value: 1, unit: "ea" }),
      m({ layer: "B", value: 1, unit: "ea" }),
    ]);
    expect(g.map((x) => x.layer)).toEqual(["B", "A"]);
  });

  it("takes the layer colour from its first run", () => {
    const g = buildLayerGroups([
      m({ layer: "L", value: 1, unit: "ea", color: "#2563eb" }),
      m({ layer: "L", value: 1, unit: "ea", color: "#16a34a" }),
    ]);
    expect(g[0].color).toBe("#2563eb");
  });
});
