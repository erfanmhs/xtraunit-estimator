/**
 * CSI MasterFormat division titles — a small code→name lookup so anywhere we
 * show a bare division number we can also show what it is ("09 — Finishes").
 * The cost tables store only the 2-digit division_code; this fills in the name.
 */
export const CSI_DIVISIONS: Record<string, string> = {
  "00": "Procurement & Contracting",
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics & Composites",
  "07": "Thermal & Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "25": "Integrated Automation",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety & Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
  "34": "Transportation",
  "35": "Waterway & Marine Construction",
  "40": "Process Interconnections",
  "41": "Material Processing & Handling Equipment",
  "44": "Pollution & Waste Control Equipment",
  "48": "Electrical Power Generation",
};

/** Normalize a division code to its 2-digit form ("3" → "03", " 9 " → "09"). */
export function normDivision(code: string | null | undefined): string | null {
  if (code == null) return null;
  const t = String(code).trim();
  if (!t) return null;
  return t.length === 1 ? `0${t}` : t;
}

/** The division's name, or "" if the code is unknown/empty. */
export function divisionName(code: string | null | undefined): string {
  const c = normDivision(code);
  return c ? (CSI_DIVISIONS[c] ?? "") : "";
}

/** A display label: "09 — Finishes", or just "09", or "—" when no code. */
export function divisionLabel(code: string | null | undefined): string {
  const c = normDivision(code);
  if (!c) return "—";
  const name = CSI_DIVISIONS[c];
  return name ? `${c} — ${name}` : c;
}
