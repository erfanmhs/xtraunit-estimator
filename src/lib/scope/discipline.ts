/**
 * Sheet discipline — the classifier + core-sheet test.
 *
 * Kept isomorphic (NO "server-only") on purpose: the browser-side "Prepare
 * plans" step classifies each sheet as it ingests, and the server-side bundle
 * re-derives as a fallback. Both import from here.
 *
 * A sheet's discipline drives retrieval/routing: the AI scope draft runs in
 * CSI-division chunks, and each chunk gets only the sheets its divisions need
 * plus the always-shared "core". See ./routing.ts and
 * docs/ai-drawing-reading-research.md (AEC-Bench: structured retrieval lifted
 * cross-sheet tasks +18–32 pts).
 *
 * The primary signal is the LABEL the user picks at plan triage
 * (Architectural / Structural / MEP / Schedules / Civil / Other — see
 * PlanTriage.tsx); the AIA sheet-number letter (A-101 → architectural) is a
 * fallback for when a sheet number is present but no label was chosen.
 */

export type Discipline =
  | "general" // cover / index / general notes — core
  | "schedules" // door/window/finish schedules — core
  | "architectural" // plans / elevations / details — core (backbone)
  | "structural"
  | "civil"
  | "landscape"
  | "mechanical"
  | "plumbing"
  | "fire"
  | "electrical"
  | "technology"
  | "interiors"
  | "mep" // combined M/E/P sheet — routes to every MEP chunk
  | "unknown"; // unclassifiable — treated as core (never dropped)

// UI options for the "correct a sheet's discipline" dropdown, in a sensible
// order. Value is the stored discipline; label is what the user sees.
export const DISCIPLINE_OPTIONS: { value: Discipline; label: string }[] = [
  { value: "architectural", label: "Architectural" },
  { value: "structural", label: "Structural" },
  { value: "civil", label: "Civil / site" },
  { value: "landscape", label: "Landscape" },
  { value: "mechanical", label: "Mechanical / HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "fire", label: "Fire protection" },
  { value: "technology", label: "Low-voltage / tech" },
  { value: "interiors", label: "Interiors" },
  { value: "mep", label: "MEP (combined)" },
  { value: "schedules", label: "Schedules / notes" },
  { value: "general", label: "General / cover" },
  { value: "unknown", label: "Unsorted" },
];

const VALID = new Set<Discipline>(DISCIPLINE_OPTIONS.map((o) => o.value));

/** Coerce an arbitrary stored string to a known Discipline, or null if unknown. */
export function asDiscipline(v: string | null | undefined): Discipline | null {
  return v && VALID.has(v as Discipline) ? (v as Discipline) : null;
}

// The exact triage labels the user chooses in PlanTriage.tsx → discipline.
const TRIAGE_LABEL: Record<string, Discipline> = {
  architectural: "architectural",
  structural: "structural",
  mep: "mep",
  schedules: "schedules",
  civil: "civil",
  other: "unknown",
};

// AIA sheet-number leading designator → discipline (fallback when a real sheet
// number is present).
const LETTER_DISCIPLINE: Record<string, Discipline> = {
  G: "general",
  H: "general",
  C: "civil",
  V: "civil",
  L: "landscape",
  S: "structural",
  A: "architectural",
  D: "architectural", // demolition plans usually live on architectural
  I: "interiors",
  Q: "interiors",
  F: "fire",
  P: "plumbing",
  M: "mechanical",
  E: "electrical",
  T: "technology",
};

// Keyword fallback when neither a triage label nor a clean sheet number decides.
const KEYWORD_DISCIPLINE: [RegExp, Discipline][] = [
  [/\bstruct/i, "structural"],
  [/\bplumb/i, "plumbing"],
  [/\bmech|hvac\b/i, "mechanical"],
  [/\belec/i, "electrical"],
  [/\bfire\b|sprinkler|fire\s*alarm/i, "fire"],
  [/\bciv(il)?\b|survey/i, "civil"],
  [/\blandscap/i, "landscape"],
  [/\binterior/i, "interiors"],
  [/\bm\.?e\.?p\.?\b/i, "mep"],
  [/schedule/i, "schedules"],
  [/\barch/i, "architectural"],
  [/general\s+notes|sheet\s+index|abbreviations|cover|title\s*sheet/i, "general"],
];

/**
 * Classify a sheet's discipline. Order: the user's triage label (most reliable
 * here — sheet numbers are usually blank) → the AIA sheet-number letter →
 * a keyword scan → "unknown" (which is treated as core, i.e. never dropped).
 */
export function classifyDiscipline(
  name: string | null,
  label: string | null,
): Discipline {
  const lab = (label ?? "").trim().toLowerCase();
  if (lab && TRIAGE_LABEL[lab]) return TRIAGE_LABEL[lab];

  const num = (name ?? "").trim();
  const m = num.match(/^([A-Za-z]{1,2})[\s\-.]?\d/);
  if (m) {
    const two = m[1].toUpperCase();
    if (two === "FP" || two === "FA") return "fire";
    if (two === "AD") return "architectural";
    if (two === "SD") return "structural";
    const one = LETTER_DISCIPLINE[two[0]];
    if (one) return one;
  }

  const hay = `${num} ${label ?? ""}`;
  for (const [re, disc] of KEYWORD_DISCIPLINE) if (re.test(hay)) return disc;
  return "unknown";
}

// Sheets sent to EVERY division chunk: cover/general notes, schedules, all
// architectural (the backbone), and anything unclassifiable. MEP and the other
// specialty disciplines are routed, not core.
const CORE_DISCIPLINES = new Set<Discipline>([
  "general",
  "schedules",
  "architectural",
  "unknown",
]);

const CORE_TEXT_MARKERS =
  /general\s+notes|sheet\s+index|abbreviations|(door|window|finish|room|fixture|equipment|hardware|plumbing|lighting)\s+schedule/i;

/** Is this a shared reference sheet that every chunk should always see? */
export function isCoreSheet(
  discipline: Discipline,
  name: string | null,
  label: string | null,
  text: string | null,
): boolean {
  if (CORE_DISCIPLINES.has(discipline)) return true;
  const hay = `${name ?? ""} ${label ?? ""} ${text ?? ""}`;
  return CORE_TEXT_MARKERS.test(hay);
}
