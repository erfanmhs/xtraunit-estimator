/**
 * XtraUnit scope taxonomy — the canonical CSI MasterFormat subcategories the AI
 * uses to draft a scope of work. Source of truth mirrored in
 * docs/scope-taxonomy.md. Goal: consistent, client-clear, work-package-level
 * line items (how you buy/price it), grouped by division, in the formal wording
 * professional GCs and public-works/government bids use.
 *
 * The AI treats this as the standard menu but MAY add a subcategory when a job
 * genuinely needs one that isn't listed (same level, same formal wording).
 * (A user-editable version is a planned follow-up.)
 */

export type ScopeSub = {
  s: string; // 6-digit CSI section, e.g. "03 30 00"
  l: string; // standard label (base of the line description)
  o?: boolean; // usually Owner's-cost / exclusion
};

export type ScopeDivision = { name: string; subs: ScopeSub[] };

export const SCOPE_TAXONOMY: Record<string, ScopeDivision> = {
  "01": {
    name: "General Requirements",
    subs: [
      { s: "01 11 00", l: "Mobilization / Demobilization" },
      { s: "01 31 13", l: "Project Superintendence — on-site superintendent" },
      { s: "01 31 00", l: "Project Management & Coordination — project manager" },
      { s: "01 31 26", l: "Project Accounting & Cost Control — project accountant" },
      { s: "01 32 33", l: "Progress Documentation — daily reports, photos, schedule" },
      { s: "01 41 00", l: "Regulatory Requirements — permitting & agency coordination (fees excluded)" },
      { s: "01 45 00", l: "Quality Control — special inspections & materials testing", o: true },
      { s: "01 51 00", l: "Temporary Utilities — power, water, lighting, toilets" },
      { s: "01 52 00", l: "Construction Facilities — field office & storage" },
      { s: "01 54 00", l: "Construction Aids — hoisting, cranes, man-lifts, scaffolding" },
      { s: "01 56 00", l: "Temporary Barriers & Controls — fencing, barricades, signage, security" },
      { s: "01 55 26", l: "Traffic Regulation & Control — flagging, signage, lane closures" },
      { s: "01 57 13", l: "Temporary Erosion & Sediment Control (SWPPP)" },
      { s: "01 57 19", l: "Temporary Environmental Controls — dust & air quality (NPDES)" },
      { s: "01 71 23", l: "Field Engineering & Surveying", o: true },
      { s: "01 74 19", l: "Construction Waste Management — dumpsters & disposal" },
      { s: "01 74 23", l: "Final Cleaning — final construction clean" },
    ],
  },
  "02": {
    name: "Existing Conditions",
    subs: [
      { s: "02 26 00", l: "Hazardous Material Abatement", o: true },
      { s: "02 31 00", l: "Site Clearing — tree & vegetation removal" },
      { s: "02 41 00", l: "Demolition — structures & surface elements" },
      { s: "02 41 19", l: "Selective Demolition — interior / partial" },
      { s: "02 65 00", l: "Utility Disconnection — cap & remove obsolete lines" },
    ],
  },
  "03": {
    name: "Concrete",
    subs: [
      { s: "03 20 00", l: "Concrete Reinforcing — rebar, supply & place" },
      { s: "03 30 00", l: "Cast-in-Place Concrete: Foundations — footings, pad footings, grade beams, stem walls" },
      { s: "03 30 00", l: "Cast-in-Place Concrete: Slab-on-Grade — form, place, finish" },
      { s: "03 30 00", l: "Cast-in-Place Concrete: Elevated Slabs & Decks" },
      { s: "03 35 00", l: "Concrete Finishing — lightweight / self-leveling topping" },
      { s: "03 45 00", l: "Precast Structural Concrete" },
    ],
  },
  "04": {
    name: "Masonry",
    subs: [
      { s: "04 20 00", l: "Unit Masonry — CMU" },
      { s: "04 40 00", l: "Stone / Adhered Veneer" },
    ],
  },
  "05": {
    name: "Metals",
    subs: [
      { s: "05 12 00", l: "Structural Steel Framing — beams & columns" },
      { s: "05 21 00", l: "Steel Joists" },
      { s: "05 50 00", l: "Metal Fabrications — miscellaneous metals" },
      { s: "05 52 00", l: "Metal Railings — guardrails & handrails" },
      { s: "05 73 00", l: "Decorative Metal Railings / Gates" },
    ],
  },
  "06": {
    name: "Wood, Plastics & Composites",
    subs: [
      { s: "06 11 00", l: "Wood Framing — walls, floors & roof (incl. sheathing, hold-downs/ATS)" },
      { s: "06 17 00", l: "Shop-Fabricated Structural Wood — trusses, I-joists / TJI" },
      { s: "06 20 00", l: "Finish Carpentry — trim & millwork" },
    ],
  },
  "07": {
    name: "Thermal & Moisture Protection",
    subs: [
      { s: "07 10 00", l: "Dampproofing & Waterproofing — below-grade & planters" },
      { s: "07 21 00", l: "Thermal Insulation — roof, wall & floor (Title 24)" },
      { s: "07 25 00", l: "Weather Barriers — house wrap / air barrier" },
      { s: "07 46 00", l: "Siding — fiber-cement (Hardie) / wood" },
      { s: "07 50 00", l: "Membrane Roofing — TPO / cool-roof system" },
      { s: "07 62 00", l: "Sheet Metal Flashing & Trim — gutters, downspouts, flashing" },
      { s: "07 84 00", l: "Firestopping" },
      { s: "07 92 00", l: "Joint Sealants — exterior sealants" },
    ],
  },
  "08": {
    name: "Openings",
    subs: [
      { s: "08 41 00", l: "Entrances & Storefronts — main entrance / storefront" },
      { s: "08 11 00", l: "Exterior Doors & Frames — exterior man doors" },
      { s: "08 11 13", l: "Fire-Rated & Smoke Doors — rated openings (stairwell, elevator lobby)" },
      { s: "08 14 00", l: "Interior Doors — interior, closet & pocket doors" },
      { s: "08 36 00", l: "Sectional / Garage Doors" },
      { s: "08 50 00", l: "Windows — (window type per plan)" },
      { s: "08 71 00", l: "Door Hardware — locks, closers, panic hardware" },
    ],
  },
  "09": {
    name: "Finishes",
    subs: [
      { s: "09 24 00", l: "Cement Plastering (Stucco) — 3-coat system & scaffolding" },
      { s: "09 29 00", l: "Gypsum Board Assemblies — hang, tape & finish (fire-rated)" },
      { s: "09 30 00", l: "Tiling — tile & shower waterproofing" },
      { s: "09 51 00", l: "Acoustical Ceilings — suspended / drop" },
      { s: "09 65 00", l: "Resilient Flooring — LVT / LVP" },
      { s: "09 68 00", l: "Carpeting" },
      { s: "09 90 00", l: "Painting & Coating — interior & exterior" },
    ],
  },
  "10": {
    name: "Specialties",
    subs: [
      { s: "10 14 00", l: "Signage — code-required interior / exterior" },
      { s: "10 21 00", l: "Toilet Compartments" },
      { s: "10 28 00", l: "Toilet & Bath Accessories — incl. ADA grab bars" },
      { s: "10 44 00", l: "Fire Protection Specialties — extinguishers & cabinets" },
    ],
  },
  "11": {
    name: "Equipment",
    subs: [
      { s: "11 31 00", l: "Residential Appliances — all-electric: ranges, refrigerators, hoods, microwaves" },
    ],
  },
  "12": {
    name: "Furnishings",
    subs: [
      { s: "12 32 00", l: "Cabinetry — kitchen & bath" },
      { s: "12 36 00", l: "Countertops" },
      { s: "12 35 30", l: "Closet Shelving & Rod" },
      { s: "12 21 00", l: "Window Treatments — blinds / shades" },
    ],
  },
  "14": {
    name: "Conveying Equipment",
    subs: [
      { s: "14 24 00", l: "Hydraulic Elevators — passenger elevator" },
      { s: "14 91 00", l: "Facility Chutes — trash / linen chute" },
    ],
  },
  "21": {
    name: "Fire Suppression",
    subs: [
      { s: "21 13 00", l: "Fire-Suppression Sprinkler System — NFPA-13 (design & install)" },
      { s: "21 30 00", l: "Fire Pumps" },
    ],
  },
  "22": {
    name: "Plumbing",
    subs: [
      { s: "22 11 00", l: "Domestic Water Distribution — supply piping rough-in" },
      { s: "22 13 00", l: "Sanitary Waste & Vent — DWV rough-in" },
      { s: "22 30 00", l: "Plumbing Equipment — water heaters (heat-pump / tankless)" },
      { s: "22 40 00", l: "Plumbing Fixtures" },
      { s: "22 05 19", l: "Meters & Gauges — water submeters" },
      { s: "22 63 00", l: "Gas Piping" },
    ],
  },
  "23": {
    name: "HVAC",
    subs: [
      { s: "23 80 00", l: "Decentralized HVAC Equipment — split / heat-pump systems & controls" },
      { s: "23 31 00", l: "HVAC Ducts & Casings — ductwork, grilles, registers" },
      { s: "23 34 00", l: "HVAC Fans — kitchen & bath exhaust" },
      { s: "23 33 00", l: "Air Duct Accessories — fire/smoke dampers, corridor make-up air" },
    ],
  },
  "26": {
    name: "Electrical",
    subs: [
      { s: "26 20 00", l: "Electrical Service & Distribution — switchgear, panels, meters" },
      { s: "26 05 19", l: "Branch Wiring & Devices — units & common areas" },
      { s: "26 51 00", l: "Interior Lighting — fixtures" },
      { s: "26 55 00", l: "Low-Voltage LED Lighting — LED fixtures, drivers & controls" },
      { s: "26 56 00", l: "Exterior & Emergency Lighting" },
      { s: "26 56 19", l: "Street & Roadway Lighting" },
    ],
  },
  "27": {
    name: "Communications",
    subs: [
      { s: "27 10 00", l: "Structured Cabling — data, phone, CATV, camera pathways" },
      { s: "27 51 16", l: "Intercom & Doorbell — entry intercom, unit doorbell" },
      { s: "27 53 00", l: "Distributed Antenna System (DAS) — emergency responder radio" },
    ],
  },
  "28": {
    name: "Electronic Safety & Security",
    subs: [
      { s: "28 13 00", l: "Access Control — entry access & door controllers" },
      { s: "28 23 00", l: "Video Surveillance — cameras" },
      { s: "28 31 00", l: "Fire Detection & Alarm — FACP, smoke detectors, horn/strobes" },
    ],
  },
  "31": {
    name: "Earthwork",
    subs: [
      { s: "31 20 00", l: "Earth Moving — excavation, grading, compaction, R&R, ABC" },
      { s: "31 22 13", l: "Rough Grading — subgrade preparation" },
      { s: "31 05 13", l: "Aggregate Base Course — base rock / subbase" },
      { s: "31 23 00", l: "Excavation & Backfill — trenching for utilities" },
      { s: "31 50 00", l: "Excavation Support & Shoring" },
      { s: "31 63 00", l: "Bored Piles / Caissons" },
    ],
  },
  "32": {
    name: "Exterior Improvements",
    subs: [
      { s: "32 12 00", l: "Flexible (Asphalt) Paving — AC paving" },
      { s: "32 13 00", l: "Concrete Paving — flatwork, walkways, driveways" },
      { s: "32 14 00", l: "Unit Paving — pavers" },
      { s: "32 16 00", l: "Curbs, Gutters & Sidewalks — public works (A-permit)", o: true },
      { s: "32 16 13", l: "Curb Ramps & ADA — truncated domes" },
      { s: "32 17 23", l: "Pavement Markings & Striping" },
      { s: "32 01 17", l: "Pavement Restoration — trench patch & repave" },
      { s: "32 32 00", l: "Retaining Walls — CIP / segmental / MSE" },
      { s: "32 31 00", l: "Fences & Gates" },
      { s: "32 39 00", l: "Site Specialties — guardrail, bollards, barriers" },
      { s: "32 80 00", l: "Irrigation" },
      { s: "32 90 00", l: "Planting — trees, shrubs, mulch" },
      { s: "32 92 00", l: "Stormwater / LID — bioretention, planters, sump" },
      { s: "32 17 00", l: "Site Amenities — bike racks, benches" },
    ],
  },
  "33": {
    name: "Utilities",
    subs: [
      { s: "33 10 00", l: "Water Utility Connection — service tap & meter" },
      { s: "33 11 00", l: "Water Distribution Main — main line" },
      { s: "33 12 19", l: "Fire Hydrants & Valves" },
      { s: "33 30 00", l: "Sanitary Sewer Connection — S-permit" },
      { s: "33 31 00", l: "Sanitary Sewer Main" },
      { s: "33 39 00", l: "Manholes — sanitary / storm structures" },
      { s: "33 40 00", l: "Storm Drainage Utility" },
      { s: "33 41 00", l: "Storm Drainage Piping" },
      { s: "33 44 00", l: "Storm Drain Structures — catch basins & inlets" },
      { s: "33 50 00", l: "Gas Service Connection" },
    ],
  },
  "34": {
    name: "Transportation",
    subs: [
      { s: "34 41 00", l: "Traffic Signals & Signalization" },
      { s: "34 71 13", l: "Vehicular Traffic Control — off-site traffic handling" },
      { s: "34 71 19", l: "Vehicle Barriers & Guardrail" },
    ],
  },
};

/** Normalize a division token ("03 Concrete", "3", "03") to its 2-digit code. */
function divCode(token: string): string {
  const m = (token ?? "").trim().match(/^\d+/);
  if (!m) return "";
  return m[0].length === 1 ? `0${m[0]}` : m[0];
}

/**
 * Format the standard subcategories for the given divisions as prompt text.
 * `divisions` are the chunk's trade tokens (e.g. ["03 Concrete","05 Metals"]);
 * pass [] for the whole taxonomy.
 */
export function taxonomyPromptText(divisions: string[]): string {
  const wanted = divisions.length
    ? new Set(divisions.map(divCode).filter(Boolean))
    : null;
  const blocks: string[] = [];
  for (const [code, div] of Object.entries(SCOPE_TAXONOMY)) {
    if (wanted && !wanted.has(code)) continue;
    const lines = div.subs.map(
      (sub) =>
        `  • [${sub.s}] ${sub.l}${sub.o ? "  (usually Owner's-cost / exclusion)" : ""}`,
    );
    blocks.push(`Division ${code} — ${div.name}:\n${lines.join("\n")}`);
  }
  if (!blocks.length) return "";
  return `STANDARD SUBCATEGORIES (use these EXACT labels as the base of each line's description; ONE line per subcategory the project actually has; roll granular components up into the matching package; you MAY add one new subcategory only if the project has scope that fits none of these — same work-package level, same formal CSI wording, no near-duplicates):\n\n${blocks.join(
    "\n\n",
  )}`;
}
