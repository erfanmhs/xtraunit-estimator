/**
 * Trade packages — the layer between "the project" and "a scope line"
 * (docs/SCOPE-WBS-DESIGN.md, feedback C1).
 *
 * A trade package is what one sub bids, what the client reads, and the unit
 * a schedule bar will hang off later. The CSI code stays on every line as a
 * cost-coding attribute (the Cost Database keys off it); it just no longer
 * dictates the structure.
 *
 * Two jobs live here:
 *   1. The catalog — names, construction-sequence order, and which CSI
 *      divisions each one usually covers. The AI is told to pick from it.
 *   2. The fallback — a line that carries no trade (every row written before
 *      migration 0041, anything hand-added, an AI slip) is filed by its CSI
 *      section. Picked by the WORK, not the filing code: stucco is Division
 *      09 but belongs with the exterior cladding sub; cabinets are Division 12
 *      but belong with finish carpentry.
 *
 * Pure: no React, no database. Shared by server (generation, proposal) and
 * client (scope canvas).
 */

export type TradePackage = {
  name: string;
  /** Rough construction order. Lower goes first. */
  sequence: number;
  /** What the client would expect to find under this heading. */
  blurb: string;
};

export const OTHER_TRADE = "Other Work";

export const TRADE_PACKAGES: TradePackage[] = [
  { name: "General Conditions", sequence: 1, blurb: "supervision, permits coordination, temporary facilities, cleanup" },
  { name: "Site Work & Demolition", sequence: 2, blurb: "demolition, clearing, excavation, grading, shoring" },
  { name: "Utilities", sequence: 3, blurb: "water, sewer, storm and gas connections and mains" },
  { name: "Concrete & Foundations", sequence: 4, blurb: "footings, stem walls, slabs, rebar, precast" },
  { name: "Masonry", sequence: 5, blurb: "CMU, brick, stone veneer" },
  { name: "Structural Steel & Metals", sequence: 6, blurb: "steel beams and columns, misc. metals, railings" },
  { name: "Framing", sequence: 7, blurb: "wood framing, trusses, sheathing, hold-downs" },
  { name: "Roofing & Waterproofing", sequence: 8, blurb: "roof systems, flashing, gutters, below-grade waterproofing" },
  { name: "Windows & Doors", sequence: 9, blurb: "windows, exterior and interior doors, hardware, skylights" },
  { name: "Exterior Cladding & Siding", sequence: 10, blurb: "stucco, siding, weather barrier, exterior sealants" },
  { name: "Plumbing", sequence: 11, blurb: "rough and finish plumbing, fixtures, water heating, gas piping" },
  { name: "HVAC", sequence: 12, blurb: "heating, cooling, ducting, ventilation" },
  { name: "Electrical", sequence: 13, blurb: "service, rough and finish electrical, lighting, solar" },
  { name: "Fire Protection", sequence: 14, blurb: "fire sprinklers and standpipes" },
  { name: "Low Voltage & Security", sequence: 15, blurb: "data, communications, fire alarm, access control, cameras" },
  { name: "Insulation & Air Sealing", sequence: 16, blurb: "thermal and acoustic insulation, firestopping" },
  { name: "Drywall, Plaster & Ceilings", sequence: 17, blurb: "gypsum board, interior plaster, suspended ceilings" },
  { name: "Finish Carpentry & Cabinets", sequence: 18, blurb: "trim, millwork, cabinets, countertops, closet shelving" },
  { name: "Flooring & Tile", sequence: 19, blurb: "tile, resilient flooring, wood flooring, carpet" },
  { name: "Painting & Coatings", sequence: 20, blurb: "interior and exterior painting, coatings" },
  { name: "Specialties & Equipment", sequence: 21, blurb: "accessories, signage, appliances, equipment, furnishings" },
  { name: "Elevators & Conveying", sequence: 22, blurb: "elevators and lifts" },
  { name: "Exterior Improvements & Landscape", sequence: 23, blurb: "paving, walks, fences, retaining walls, irrigation, planting" },
  { name: OTHER_TRADE, sequence: 99, blurb: "anything that fits none of the above" },
];

const BY_NAME = new Map(TRADE_PACKAGES.map((t) => [t.name.toLowerCase(), t]));

export function isTradePackage(name: string | null | undefined): boolean {
  return !!name && BY_NAME.has(name.trim().toLowerCase());
}

/** Catalog order for a trade name; unknown (custom) names sort just before "Other Work". */
export function tradeSequence(name: string | null | undefined): number {
  if (!name) return 99;
  return BY_NAME.get(name.trim().toLowerCase())?.sequence ?? 98;
}

/** The catalog spelling of a name, if it is one. */
function canonical(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_NAME.get(name.trim().toLowerCase())?.name ?? null;
}

type Classifiable = {
  division_code?: string | null;
  section_code?: string | null;
};

/** "07 21 00" → "07 21"; "7" → "07". Tolerant of the odd formats that reach the DB. */
function series(code: string | null | undefined): { division: string; series: string } {
  const digits = (code ?? "").replace(/\D/g, "");
  const division = digits.length >= 2 ? digits.slice(0, 2) : digits ? digits.padStart(2, "0") : "";
  const s = digits.length >= 4 ? digits.slice(2, 4) : "";
  return { division, series: s };
}

/**
 * File a line by its CSI section when it carries no trade of its own. The
 * split divisions are the interesting cases — 06, 07, 09 and 12 each feed
 * two or three different subs.
 */
export function tradeFor(line: Classifiable): string {
  const fromSection = series(line.section_code);
  const division = fromSection.division || series(line.division_code).division;
  const s = fromSection.division === division ? fromSection.series : "";
  const s2 = s.slice(0, 1); // the tens digit: "2" for 09 2x

  switch (division) {
    case "01":
      return "General Conditions";
    case "02":
    case "31":
      return "Site Work & Demolition";
    case "33":
      return "Utilities";
    case "03":
      return "Concrete & Foundations";
    case "04":
      return "Masonry";
    case "05":
      return "Structural Steel & Metals";
    case "06":
      // 06 2x finish carpentry, 06 4x architectural woodwork → finish side.
      return s2 === "2" || s2 === "4" ? "Finish Carpentry & Cabinets" : "Framing";
    case "07":
      if (s === "21" || s === "22" || s === "27" || s === "84") return "Insulation & Air Sealing";
      if (s2 === "4" || s === "25" || s === "92") return "Exterior Cladding & Siding";
      return "Roofing & Waterproofing";
    case "08":
      return "Windows & Doors";
    case "09":
      if (s === "24") return "Exterior Cladding & Siding"; // stucco
      if (s2 === "2" || s2 === "5") return "Drywall, Plaster & Ceilings";
      if (s2 === "9") return "Painting & Coatings";
      if (s2 === "3" || s2 === "6" || s2 === "7") return "Flooring & Tile";
      return "Drywall, Plaster & Ceilings";
    case "10":
    case "11":
      return "Specialties & Equipment";
    case "12":
      return s2 === "3" ? "Finish Carpentry & Cabinets" : "Specialties & Equipment";
    case "14":
      return "Elevators & Conveying";
    case "21":
      return "Fire Protection";
    case "22":
      return "Plumbing";
    case "23":
      return "HVAC";
    case "26":
      return "Electrical";
    case "27":
    case "28":
      return "Low Voltage & Security";
    case "32":
    case "34":
      return "Exterior Improvements & Landscape";
    default:
      return OTHER_TRADE;
  }
}

/**
 * The trade a line should display under: its own trade if it is a real one,
 * otherwise the CSI fallback. A custom trade name typed by the user is kept
 * as-is — it just is not in the catalog.
 */
export function tradeOf(line: Classifiable & { trade_package?: string | null }): string {
  const own = line.trade_package?.trim();
  if (!own) return tradeFor(line);
  return canonical(own) ?? own;
}

/**
 * What the AI handed us, made safe to store: the catalog spelling when it
 * named a real package, the CSI fallback when it named nothing or something
 * we do not recognise. The AI is asked to pick from the list, so an unknown
 * name is a slip, not a new trade.
 */
export function normalizeTrade(candidate: string | null | undefined, line: Classifiable): string {
  return canonical(candidate) ?? tradeFor(line);
}

export type TradeGroup<T> = { trade: string; sequence: number; rows: T[] };

/**
 * Group lines by trade in construction order. Within a trade the caller's
 * order is kept (the AI already writes lines in construction sequence).
 */
export function groupByTrade<T extends Classifiable & { trade_package?: string | null }>(
  lines: readonly T[],
): TradeGroup<T>[] {
  const groups = new Map<string, TradeGroup<T>>();
  for (const li of lines) {
    const trade = tradeOf(li);
    let g = groups.get(trade);
    if (!g) {
      g = { trade, sequence: tradeSequence(trade), rows: [] };
      groups.set(trade, g);
    }
    g.rows.push(li);
  }
  return [...groups.values()].sort((a, b) => a.sequence - b.sequence || a.trade.localeCompare(b.trade));
}

/**
 * The CSI division a trade files under by default — for a line created
 * without one (a sub quote arriving before the scope has any lines for that
 * trade). Where a trade spans divisions, the one most of its work sits in.
 */
const HOME_DIVISION: Record<string, { code: string; name: string }> = {
  "General Conditions": { code: "01", name: "General Requirements" },
  "Site Work & Demolition": { code: "02", name: "Existing Conditions" },
  Utilities: { code: "33", name: "Utilities" },
  "Concrete & Foundations": { code: "03", name: "Concrete" },
  Masonry: { code: "04", name: "Masonry" },
  "Structural Steel & Metals": { code: "05", name: "Metals" },
  Framing: { code: "06", name: "Wood, Plastics & Composites" },
  "Roofing & Waterproofing": { code: "07", name: "Thermal & Moisture Protection" },
  "Windows & Doors": { code: "08", name: "Openings" },
  "Exterior Cladding & Siding": { code: "07", name: "Thermal & Moisture Protection" },
  Plumbing: { code: "22", name: "Plumbing" },
  HVAC: { code: "23", name: "HVAC" },
  Electrical: { code: "26", name: "Electrical" },
  "Fire Protection": { code: "21", name: "Fire Suppression" },
  "Low Voltage & Security": { code: "27", name: "Communications" },
  "Insulation & Air Sealing": { code: "07", name: "Thermal & Moisture Protection" },
  "Drywall, Plaster & Ceilings": { code: "09", name: "Finishes" },
  "Finish Carpentry & Cabinets": { code: "06", name: "Wood, Plastics & Composites" },
  "Flooring & Tile": { code: "09", name: "Finishes" },
  "Painting & Coatings": { code: "09", name: "Finishes" },
  "Specialties & Equipment": { code: "10", name: "Specialties" },
  "Elevators & Conveying": { code: "14", name: "Conveying Equipment" },
  "Exterior Improvements & Landscape": { code: "32", name: "Exterior Improvements" },
};
export function homeDivision(trade: string): { code: string; name: string } | null {
  return HOME_DIVISION[canonical(trade) ?? ""] ?? null;
}

/** The catalog as the AI sees it. */
export function tradePromptText(): string {
  const lines = TRADE_PACKAGES.filter((t) => t.name !== OTHER_TRADE).map(
    (t) => `  • ${t.name} — ${t.blurb}`,
  );
  return `TRADE PACKAGES (every line's trade_package MUST be one of these names, spelled exactly; pick by the WORK a sub would bid, not by the CSI division — stucco is "Exterior Cladding & Siding" although it files under 09, cabinets are "Finish Carpentry & Cabinets" although they file under 12):\n${lines.join("\n")}`;
}
