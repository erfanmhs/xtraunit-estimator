import { describe, expect, it } from "vitest";
import { exclusionItems, resolveHidden, shownExclusions } from "./exclusions";

const lines = [
  { id: "a", status: "confirmed", deliverable: "Rough plumbing", description: "Plumbing rough-in", excludes: "fixture supply by owner", trade: "Plumbing" },
  { id: "b", status: "excluded", deliverable: "Landscaping", description: "Landscape", excludes: null, trade: "Sitework" },
  { id: "c", status: "excluded", deliverable: null, description: "Pool", excludes: "ignored on an excluded line", trade: "Sitework" },
];
const findings = [
  { id: "f1", kind: "exclusion", text: "Permit fees by owner", status: "open" },
  { id: "f2", kind: "exclusion", text: "Hazmat abatement", status: "dismissed" },
  { id: "f3", kind: "exclusion", text: "Applied already", status: "accepted", resolved: true },
  { id: "f4", kind: "assumption", text: "Not an exclusion", status: "open" },
];

describe("exclusionItems", () => {
  it("lists every source in print order, whole lines first", () => {
    const items = exclusionItems({ lines, findings, standard: ["Utility fees", "Furniture"], hidden: ["Furniture"] });
    expect(items.map((i) => i.text)).toEqual([
      "Landscaping",
      "Pool",
      "Plumbing — fixture supply by owner",
      "Permit fees by owner",
      "Hazmat abatement",
      "Utility fees",
      "Furniture",
    ]);
    expect(items.map((i) => i.source)).toEqual(["line", "line", "note", "finding", "finding", "standard", "standard"]);
  });
  it("marks dismissed findings and hidden standard items, and leaves them off the client's list", () => {
    const items = exclusionItems({ lines, findings, standard: ["Utility fees", "Furniture"], hidden: ["Furniture"] });
    expect(items.filter((i) => "hidden" in i && i.hidden).map((i) => i.text)).toEqual(["Hazmat abatement", "Furniture"]);
    expect(shownExclusions(items)).toEqual([
      "Landscaping",
      "Pool",
      "Plumbing — fixture supply by owner",
      "Permit fees by owner",
      "Utility fees",
    ]);
  });
  it("skips resolved findings, other kinds, and blank standard lines", () => {
    const items = exclusionItems({ lines: [], findings, standard: ["", "  "], hidden: [] });
    expect(items.map((i) => i.text)).toEqual(["Permit fees by owner", "Hazmat abatement"]);
  });
});

describe("resolveHidden", () => {
  it("reads a stored list and tolerates junk", () => {
    expect(resolveHidden(["A", " B ", "", null])).toEqual(["A", "B"]);
    expect(resolveHidden(null)).toEqual([]);
    expect(resolveHidden("x")).toEqual([]);
  });
});
