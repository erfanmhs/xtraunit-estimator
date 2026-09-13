import { describe, expect, it } from "vitest";
import { blockedLayers, isDefaultLayerName, layerFits, layerTypeOf, nextLayerName } from "./layers";

const rows = [
  { type: "area", layer: "Floors" },
  { type: "area", layer: "Floors" },
  { type: "count", layer: "Doors" },
  { type: "line", layer: null },
];

describe("one type per layer", () => {
  it("knows what a layer holds", () => {
    expect(layerTypeOf(rows, "Floors")).toBe("area");
    expect(layerTypeOf(rows, "  Floors ")).toBe("area"); // trimmed like everywhere else; case matters
    expect(layerTypeOf(rows, "Roof")).toBeNull();
  });
  it("lets a run join an empty or same-type layer and refuses a different type", () => {
    expect(layerFits(rows, "Floors", "area")).toBe(true);
    expect(layerFits(rows, "Roof", "count")).toBe(true);
    expect(layerFits(rows, "Floors", "count")).toBe(false);
    expect(layerFits(rows, "Doors", "area")).toBe(false);
  });
  it("lists the layers a tool may not use, with what they hold", () => {
    expect(blockedLayers(rows, "count")).toEqual({ Floors: "area" });
    expect(blockedLayers(rows, "area")).toEqual({ Doors: "count" });
    expect(blockedLayers(rows, "wall")).toEqual({ Floors: "area", Doors: "count" });
  });
});

describe("automatic names", () => {
  it("counts up from the highest default in use, ignoring real names", () => {
    expect(nextLayerName([])).toBe("Layer 1");
    expect(nextLayerName(["Floors", "Layer 1", "Layer 2"])).toBe("Layer 3");
    expect(nextLayerName(["layer 7", "Doors"])).toBe("Layer 8");
    expect(nextLayerName(["Layer 3", "Layer 1"])).toBe("Layer 4"); // never reuses a freed number
  });
  it("recognises its own names", () => {
    expect(isDefaultLayerName("Layer 12")).toBe(true);
    expect(isDefaultLayerName("Exterior walls")).toBe(false);
  });
});
