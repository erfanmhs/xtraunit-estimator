/**
 * Proposal maths — what the client is actually asked to pay. A mistake here
 * goes out on a signed document, so the packages and line amounts are checked
 * against hand-worked numbers.
 */
import { describe, expect, it } from "vitest";
import {
  cleanOptions,
  cleanTimeline,
  defaultSelection,
  lineAmount,
  plusDays,
  selectionTotal,
  tierSelection,
  tierTotals,
  type LineInput,
  type ProposalDoc,
} from "./model";

function line(over: Partial<LineInput> = {}): LineInput {
  return {
    id: "l1",
    division_code: "09",
    division_name: "Finishes",
    description: "Paint",
    quantity: null,
    unit: null,
    status: "confirmed",
    price_mode: "unit",
    cost_labor: null,
    cost_material: null,
    cost_sub: null,
    cost_equipment: null,
    cost_other: null,
    cost_total: null,
    price_status: "confirmed",
    ...over,
  };
}

describe("lineAmount", () => {
  it("unit mode multiplies the buckets by the quantity", () => {
    // 1,000 sf at $2 + $1.50 = $3.50/sf = $3,500
    expect(
      lineAmount(line({ price_mode: "unit", quantity: 1000, cost_labor: 2, cost_material: 1.5 })),
    ).toBeCloseTo(3500, 10);
  });

  it("lump mode is the buckets, ignoring quantity", () => {
    expect(
      lineAmount(line({ price_mode: "lump", quantity: 999, cost_sub: 12000 })),
    ).toBe(12000);
  });

  it("total mode overrides the buckets entirely", () => {
    expect(
      lineAmount(line({ price_mode: "total", quantity: 10, cost_labor: 5, cost_total: 999 })),
    ).toBe(999);
  });

  it("treats a missing mode as unit", () => {
    expect(lineAmount(line({ price_mode: null, quantity: 3, cost_labor: 10 }))).toBe(30);
  });

  it("a unit line with no quantity is zero, not the bucket sum", () => {
    // Guards the 1000x mistake: $30,000 entered as a rate with no qty.
    expect(lineAmount(line({ price_mode: "unit", quantity: null, cost_labor: 30000 }))).toBe(0);
  });

  it("sums all five buckets", () => {
    expect(
      lineAmount(
        line({
          price_mode: "lump",
          cost_labor: 1,
          cost_material: 2,
          cost_sub: 4,
          cost_equipment: 8,
          cost_other: 16,
        }),
      ),
    ).toBe(31);
  });
});

function doc(total: number, options: ProposalDoc["pricing"]["options"]): ProposalDoc {
  return { pricing: { total, options } } as unknown as ProposalDoc;
}

describe("packages", () => {
  const d = doc(100000, [
    { id: "a", title: "Upgraded tile", description: "", amount: 5000, tier: "recommended", default_on: true },
    { id: "b", title: "Skylight", description: "", amount: 8000, tier: "enhanced", default_on: false },
  ]);

  it("base is the bid on its own", () => {
    expect(tierTotals(d).base).toBe(100000);
  });

  it("recommended adds only the recommended options", () => {
    expect(tierTotals(d).recommended).toBe(105000);
  });

  it("enhanced adds recommended AND enhanced (it is cumulative)", () => {
    expect(tierTotals(d).enhanced).toBe(113000);
  });

  it("reports which packages exist", () => {
    const t = tierTotals(d);
    expect(t.hasRecommended).toBe(true);
    expect(t.hasEnhanced).toBe(true);
    const bare = tierTotals(doc(50000, []));
    expect(bare.hasRecommended).toBe(false);
    expect(bare.hasEnhanced).toBe(false);
    expect(bare.base).toBe(bare.enhanced);
  });

  it("selectionTotal adds exactly what the client ticked", () => {
    expect(selectionTotal(d, new Set())).toBe(100000);
    expect(selectionTotal(d, new Set(["a"]))).toBe(105000);
    expect(selectionTotal(d, new Set(["a", "b"]))).toBe(113000);
    expect(selectionTotal(d, new Set(["nope"]))).toBe(100000);
  });

  it("tierSelection matches its total", () => {
    expect(selectionTotal(d, tierSelection(d, "base"))).toBe(tierTotals(d).base);
    expect(selectionTotal(d, tierSelection(d, "recommended"))).toBe(tierTotals(d).recommended);
    expect(selectionTotal(d, tierSelection(d, "enhanced"))).toBe(tierTotals(d).enhanced);
  });

  it("defaultSelection picks the options marked on", () => {
    expect([...defaultSelection(d)]).toEqual(["a"]);
  });
});

describe("cleanOptions", () => {
  it("drops anything without a title", () => {
    expect(cleanOptions([{ title: "" }, { title: "Real" }])).toHaveLength(1);
  });

  it("survives junk instead of a list", () => {
    expect(cleanOptions(null)).toEqual([]);
    expect(cleanOptions("nope")).toEqual([]);
    expect(cleanOptions([null, undefined])).toEqual([]);
  });

  it("forces a non-numeric amount to zero rather than NaN", () => {
    const [o] = cleanOptions([{ title: "X", amount: "abc" }]);
    expect(o.amount).toBe(0);
  });

  it("defaults an unknown tier to recommended", () => {
    expect(cleanOptions([{ title: "X", tier: "nonsense" }])[0].tier).toBe("recommended");
  });
});

describe("cleanTimeline", () => {
  it("survives junk", () => {
    const t = cleanTimeline(null);
    expect(t.milestones).toEqual([]);
    expect(t.assumptions).toEqual([]);
  });

  it("drops milestones with no label and blank assumptions", () => {
    const t = cleanTimeline({
      milestones: [{ label: "" }, { label: "Permit" }],
      assumptions: ["", "  ", "Dry weather"],
    });
    expect(t.milestones).toHaveLength(1);
    expect(t.assumptions).toEqual(["Dry weather"]);
  });
});

describe("plusDays", () => {
  it("adds days and returns a plain date", () => {
    expect(plusDays("2026-01-01T00:00:00Z", 30)).toBe("2026-01-31");
  });

  it("rolls over a month end", () => {
    expect(plusDays("2026-01-20T00:00:00Z", 30)).toBe("2026-02-19");
  });

  it("handles a leap year", () => {
    expect(plusDays("2028-02-28T00:00:00Z", 1)).toBe("2028-02-29");
  });
});
