import { describe, expect, it } from "vitest";
import { SCOPE_TAXONOMY } from "./taxonomy";
import {
  OTHER_TRADE,
  TRADE_PACKAGES,
  groupByTrade,
  isTradePackage,
  normalizeTrade,
  tradeFor,
  tradeOf,
  tradePromptText,
  tradeSequence,
} from "./trades";

describe("the catalog", () => {
  it("has unique names and a strict construction order", () => {
    const names = TRADE_PACKAGES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const seq = TRADE_PACKAGES.map((t) => t.sequence);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    expect(new Set(seq).size).toBe(seq.length);
  });

  it("files every subcategory in the taxonomy somewhere real", () => {
    for (const [division, div] of Object.entries(SCOPE_TAXONOMY)) {
      for (const sub of div.subs) {
        const trade = tradeFor({ division_code: division, section_code: sub.s });
        expect(trade, `${sub.s} ${sub.l}`).not.toBe(OTHER_TRADE);
        expect(isTradePackage(trade)).toBe(true);
      }
    }
  });
});

describe("tradeFor — the CSI fallback", () => {
  it("splits the divisions that feed more than one sub", () => {
    expect(tradeFor({ division_code: "06", section_code: "06 11 00" })).toBe("Framing");
    expect(tradeFor({ division_code: "06", section_code: "06 20 00" })).toBe("Finish Carpentry & Cabinets");
    expect(tradeFor({ division_code: "07", section_code: "07 21 00" })).toBe("Insulation & Air Sealing");
    expect(tradeFor({ division_code: "07", section_code: "07 46 00" })).toBe("Exterior Cladding & Siding");
    expect(tradeFor({ division_code: "07", section_code: "07 50 00" })).toBe("Roofing & Waterproofing");
    expect(tradeFor({ division_code: "09", section_code: "09 24 00" })).toBe("Exterior Cladding & Siding");
    expect(tradeFor({ division_code: "09", section_code: "09 29 00" })).toBe("Drywall, Plaster & Ceilings");
    expect(tradeFor({ division_code: "09", section_code: "09 65 00" })).toBe("Flooring & Tile");
    expect(tradeFor({ division_code: "09", section_code: "09 90 00" })).toBe("Painting & Coatings");
    expect(tradeFor({ division_code: "12", section_code: "12 32 00" })).toBe("Finish Carpentry & Cabinets");
    expect(tradeFor({ division_code: "12", section_code: "12 21 00" })).toBe("Specialties & Equipment");
  });

  it("falls back to the division when there is no section, and to Other when there is nothing", () => {
    expect(tradeFor({ division_code: "22", section_code: null })).toBe("Plumbing");
    expect(tradeFor({ division_code: "9", section_code: null })).toBe("Drywall, Plaster & Ceilings");
    expect(tradeFor({ division_code: null, section_code: null })).toBe(OTHER_TRADE);
    expect(tradeFor({ division_code: "99", section_code: null })).toBe(OTHER_TRADE);
  });

  it("trusts the section over a mismatched division code", () => {
    expect(tradeFor({ division_code: "06", section_code: "09 24 00" })).toBe("Exterior Cladding & Siding");
  });
});

describe("normalizeTrade / tradeOf", () => {
  const line = { division_code: "22", section_code: "22 40 00" };
  it("keeps a real name in catalog spelling, ignoring case and spaces", () => {
    expect(normalizeTrade("  plumbing ", line)).toBe("Plumbing");
    expect(normalizeTrade("HVAC", line)).toBe("HVAC");
  });
  it("replaces a made-up name with the CSI fallback", () => {
    expect(normalizeTrade("Wet Trades", line)).toBe("Plumbing");
    expect(normalizeTrade(null, line)).toBe("Plumbing");
  });
  it("tradeOf keeps a custom name the user typed, but not a blank one", () => {
    expect(tradeOf({ ...line, trade_package: "Pool" })).toBe("Pool");
    expect(tradeOf({ ...line, trade_package: "  " })).toBe("Plumbing");
    expect(tradeSequence("Pool")).toBe(98);
    expect(tradeSequence(OTHER_TRADE)).toBe(99);
  });
});

describe("groupByTrade", () => {
  it("orders groups by construction sequence and keeps row order inside", () => {
    const rows = [
      { id: "a", division_code: "09", section_code: "09 90 00", trade_package: null },
      { id: "b", division_code: "03", section_code: "03 30 00", trade_package: null },
      { id: "c", division_code: "06", section_code: "06 11 00", trade_package: "Framing" },
      { id: "d", division_code: "06", section_code: "06 17 00", trade_package: "framing" },
      { id: "e", division_code: "03", section_code: "03 20 00", trade_package: null },
    ];
    const groups = groupByTrade(rows);
    expect(groups.map((g) => g.trade)).toEqual(["Concrete & Foundations", "Framing", "Painting & Coatings"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b", "e"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["c", "d"]);
  });
});

describe("tradePromptText", () => {
  it("lists every catalog trade except Other, spelled exactly", () => {
    const text = tradePromptText();
    for (const t of TRADE_PACKAGES) {
      if (t.name === OTHER_TRADE) expect(text).not.toContain(t.name);
      else expect(text).toContain(`• ${t.name} —`);
    }
  });
});
