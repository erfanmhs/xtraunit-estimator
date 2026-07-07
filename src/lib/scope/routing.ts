import "server-only";

/**
 * Retrieval/routing layer for AI scope drafting.
 *
 * The draft runs in CSI-division chunks. Sending the WHOLE plan set to every
 * chunk buries each division in irrelevant sheets — the cross-sheet noise that
 * hurts drawing reasoning (docs/ai-drawing-reading-research.md). This module
 * maps each CSI division to the specialty disciplines it needs; a chunk then
 * reads only those sheets PLUS the always-shared core (cover / general notes /
 * schedules / all architectural — see isCoreSheet in ./discipline.ts).
 *
 * Architectural is core on purpose (the backbone discipline, biggest risk to
 * drop). The token win comes from NOT sending structural to the electrical
 * chunk, MEP to the concrete chunk, and so on. A sheet the user tagged "MEP"
 * gets discipline "mep" and routes to every MEP chunk.
 */
import type { Discipline } from "./discipline";

// CSI division (2-digit code) → the specialty disciplines that division needs,
// ON TOP OF the always-shared core. A division absent here needs nothing beyond
// core. "mep" is added wherever a combined M/E/P sheet is relevant.
const DIVISION_ROUTED_DISCIPLINES: Record<string, Discipline[]> = {
  "02": ["structural"], // demolition
  "03": ["structural"], // concrete
  "04": ["structural"], // masonry
  "05": ["structural"], // metals
  "06": ["structural"], // wood framing
  "07": ["structural"], // thermal & moisture / roofing
  "09": ["interiors"], // finishes
  "10": ["interiors"], // specialties
  "11": ["interiors"], // equipment
  "12": ["interiors"], // furnishings
  "14": ["mechanical", "structural", "mep"], // conveying / elevators
  "21": ["fire", "plumbing", "mep"], // fire suppression
  "22": ["plumbing", "mep"], // plumbing
  "23": ["mechanical", "mep"], // HVAC
  "26": ["electrical", "mep"], // electrical
  "27": ["technology", "electrical", "mep"], // communications
  "28": ["electrical", "technology", "mep"], // electronic safety & security
  "31": ["civil", "structural"], // earthwork
  "32": ["civil", "landscape"], // exterior improvements
  "33": ["civil", "plumbing", "mep"], // utilities
};

/** Extract the 2-digit division code from a trade string like "03 Concrete". */
function tradeCode(trade: string): string {
  return (trade.split(/\s+/)[0] || "").padStart(2, "0");
}

/**
 * The specialty disciplines a chunk's divisions need beyond core. Empty trades
 * (a whole-building call with no chunk) returns null = send everything.
 */
export function routedDisciplines(trades: string[]): Set<Discipline> | null {
  if (!trades.length) return null;
  const out = new Set<Discipline>();
  for (const t of trades)
    for (const d of DIVISION_ROUTED_DISCIPLINES[tradeCode(t)] ?? []) out.add(d);
  return out;
}
