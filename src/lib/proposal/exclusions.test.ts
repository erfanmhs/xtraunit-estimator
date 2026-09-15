import { describe, expect, it } from "vitest";
import { exclusionItems, groupExclusions, printedExclusionGroups, resolveHidden, shownExclusions } from "./exclusions";

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
      "Sitework — Landscaping",
      "Sitework — Pool",
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
      "Sitework — Landscaping",
      "Sitework — Pool",
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

describe("groupExclusions", () => {
  it("gathers by trade in scope order, then the plan review, then the standard list", () => {
    const items = exclusionItems({ lines, findings, standard: ["Utility fees", "Furniture"], hidden: ["Furniture"] });
    const groups = groupExclusions(items);
    expect(groups.map((g) => `${g.kind}:${g.title}:${g.items.length}`)).toEqual([
      "trade:Sitework:2",
      "trade:Plumbing:1",
      "review:Noted while reading the plans:2",
      "standard:Standard on every proposal:2",
    ]);
    expect(groups[1].items[0].short).toBe("fixture supply by owner");
  });
  it("drops an item's own trailing period, since the page joins items with semicolons", () => {
    const items = exclusionItems({ lines: [], findings: [{ id: "x", kind: "exclusion", text: "Permit fees by owner." }], standard: [], hidden: [] });
    expect(printedExclusionGroups(items)[0].items).toEqual(["Permit fees by owner"]);
  });
  it("prints short texts under each heading and leaves hidden ones out", () => {
    const items = exclusionItems({ lines, findings, standard: ["Utility fees", "Furniture"], hidden: ["Furniture"] });
    expect(printedExclusionGroups(items)).toEqual([
      { title: "Sitework", items: ["Landscaping", "Pool"] },
      { title: "Plumbing", items: ["fixture supply by owner"] },
      { title: "Noted while reading the plans", items: ["Permit fees by owner"] },
      { title: "Standard on every proposal", items: ["Utility fees"] },
    ]);
  });
});

describe("resolveHidden", () => {
  it("reads a stored list and tolerates junk", () => {
    expect(resolveHidden(["A", " B ", "", null])).toEqual(["A", "B"]);
    expect(resolveHidden(null)).toEqual([]);
    expect(resolveHidden("x")).toEqual([]);
  });
});
