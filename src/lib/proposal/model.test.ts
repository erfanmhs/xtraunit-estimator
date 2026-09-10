/**
 * Proposal maths — what the client is actually asked to pay. A mistake here
 * goes out on a signed document, so the packages and line amounts are checked
 * against hand-worked numbers.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "./profile";
import {
  buildProposalDoc,
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

/**
 * Excluding a line is a decision about what is in the bid, not an instruction
 * to forget it. The line has to survive all the way to the client's Exclusions
 * list — that section is what prevents most scope disputes, so a silent drop
 * here would be expensive.
 */
describe("excluded lines reach the proposal", () => {
  function doc(lines: LineInput[], findings: { kind: string; text: string }[] = []) {
    return buildProposalDoc({
      company: {
        company_name: "XtraUnit",
        company_address: null,
        company_phone: null,
        company_email: null,
        company_license: null,
        signer_name: null,
        signer_title: null,
      },
      profile: DEFAULT_PROFILE,
      project: {
        name: "Test",
        client_name: null,
        address: null,
        building_sf: null,
        project_type: null,
      },
      lines,
      markups: { contingency_pct: 0, insurance_pct: 0, overhead_pct: 0 },
      findings,
      fields: {} as never,
    });
  }

  it("lists an excluded line under Exclusions", () => {
    const d = doc([
      line({ id: "a", description: "Paint", cost_total: 1000, price_mode: "total" }),
      line({ id: "b", description: "Landscaping", status: "excluded" }),
    ]);
    expect(d.scope.excluded).toContain("Landscaping");
  });

  it("keeps it out of the priced scope and out of the total", () => {
    const d = doc([
      line({ id: "a", description: "Paint", cost_total: 1000, price_mode: "total" }),
      line({ id: "b", description: "Landscaping", status: "excluded", cost_total: 9999, price_mode: "total" }),
    ]);
    const shown = d.scope.divisions.flatMap((x) => x.rows.map((r) => r.description));
    expect(shown).toContain("Paint");
    expect(shown).not.toContain("Landscaping");
    expect(d.pricing.direct).toBe(1000);
  });

  it("keeps exclusion findings alongside excluded lines", () => {
    const d = doc(
      [line({ id: "b", description: "Landscaping", status: "excluded" })],
      [{ kind: "exclusion", text: "Permit fees by owner" }],
    );
    expect(d.scope.excluded).toEqual(
      expect.arrayContaining(["Landscaping", "Permit fees by owner"]),
    );
  });
});

describe("scope by trade (SCOPE-WBS-DESIGN)", () => {
  function doc(lines: LineInput[], findings: { kind: string; text: string }[] = []) {
    return buildProposalDoc({
      company: {
        company_name: "XtraUnit",
        company_address: null,
        company_phone: null,
        company_email: null,
        company_license: null,
        signer_name: null,
        signer_title: null,
      },
      profile: DEFAULT_PROFILE,
      project: { name: "Test", client_name: null, address: null, building_sf: null, project_type: null },
      lines,
      markups: { contingency_pct: 0, insurance_pct: 0, overhead_pct: 0 },
      findings,
      fields: {} as never,
    });
  }

  it("groups lines by trade package in construction order, not by CSI division", () => {
    const d = doc([
      line({ id: "a", division_code: "09", division_name: "Finishes", section_code: "09 90 00", description: "Painting & Coating", trade_package: "Painting & Coatings" }),
      line({ id: "b", division_code: "03", division_name: "Concrete", section_code: "03 30 00", description: "Cast-in-Place Concrete: Foundations", trade_package: "Concrete & Foundations" }),
      line({ id: "c", division_code: "09", division_name: "Finishes", section_code: "09 24 00", description: "Cement Plastering (Stucco)", trade_package: null }),
    ]);
    expect(d.scope.divisions.map((x) => x.name)).toEqual([
      "Concrete & Foundations",
      "Exterior Cladding & Siding", // stucco files with the cladding sub, not with Finishes
      "Painting & Coatings",
    ]);
    expect(d.scope.divisions.every((x) => x.code === null)).toBe(true);
  });

  it("shows the deliverable as the headline and the includes underneath, falling back to the CSI label", () => {
    const d = doc([
      line({
        id: "a",
        description: "Plumbing Fixtures",
        section_code: "22 40 00",
        deliverable: "Fixture set — 2 baths, kitchen, laundry",
        includes: "Set and connect owner-supplied fixtures.",
        trade_package: "Plumbing",
      }),
      line({ id: "b", division_code: "22", description: "Water Heaters", section_code: "22 33 00" }),
    ]);
    const rows = d.scope.divisions.find((x) => x.name === "Plumbing")!.rows;
    expect(rows[0]).toMatchObject({
      description: "Fixture set — 2 baths, kitchen, laundry",
      detail: "Set and connect owner-supplied fixtures.",
      code: "22 40 00",
    });
    expect(rows[1]).toMatchObject({ description: "Water Heaters", detail: null });
  });

  it("rolls each line's own excludes into the Excluded list, labelled by trade", () => {
    const d = doc([
      line({ id: "a", division_code: "22", description: "Plumbing Fixtures", excludes: "Fixture supply by owner." }),
      line({ id: "b", division_code: "22", description: "Gas Piping", excludes: "   " }),
    ]);
    expect(d.scope.excluded).toEqual(["Plumbing — Fixture supply by owner."]);
  });

  it("sums a trade's priced lines into its total", () => {
    const d = doc([
      line({ id: "a", division_code: "22", description: "A", cost_total: 100, price_mode: "total" }),
      line({ id: "b", division_code: "22", description: "B", cost_total: 250, price_mode: "total" }),
      line({ id: "c", division_code: "26", description: "C", cost_total: 1, price_mode: "total" }),
    ]);
    expect(d.scope.divisions.find((x) => x.name === "Plumbing")!.total).toBe(350);
    expect(d.scope.divisions.find((x) => x.name === "Electrical")!.total).toBe(1);
  });
});
