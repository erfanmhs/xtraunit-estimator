/**
 * The layer rule: a layer holds ONE kind of measurement. Areas live with
 * areas, counts with counts. Switching tools starts a new layer, named
 * "Layer 1", "Layer 2", … until the user gives it a real name.
 *
 * Pure helpers, so the viewer's decisions ("does this name fit this tool?",
 * "what is the next free name?") are testable without a browser.
 */
import { layerKeyOf } from "./geometry";

export type LayerRow = { type: string; layer: string | null };

/** What a tool's runs are called when a name is refused: "a count layer". */
export const TYPE_NOUN: Record<string, string> = {
  line: "lines",
  polyline: "polylines",
  area: "areas",
  wall: "walls",
  volume: "volumes",
  count: "counts",
  leader: "notes",
};

/** The measurement type a layer already holds on this sheet, or null if it is empty / unknown. */
export function layerTypeOf(rows: LayerRow[], name: string): string | null {
  const key = layerKeyOf(name);
  const first = rows.find((m) => layerKeyOf(m.layer) === key);
  return first ? first.type : null;
}

/** May runs of `type` be added to layer `name`? (Empty layer: yes. Same type: yes.) */
export function layerFits(rows: LayerRow[], name: string, type: string): boolean {
  const held = layerTypeOf(rows, name);
  return held === null || held === type;
}

/** Every layer name on this sheet that holds a DIFFERENT type, with what it holds. */
export function blockedLayers(rows: LayerRow[], type: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rows) {
    const key = layerKeyOf(m.layer);
    if (key === "Unlabeled" || key in out) continue;
    const held = layerTypeOf(rows, key);
    if (held && held !== type) out[key] = held;
  }
  return out;
}

const DEFAULT_RE = /^layer\s+(\d+)$/i;

/** "Layer N" with N one past the highest default name in use — numbers only ever go up. */
export function nextLayerName(used: Iterable<string>): string {
  let max = 0;
  for (const n of used) {
    const m = DEFAULT_RE.exec(n.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Layer ${max + 1}`;
}

/** Is this one of the automatic names (so a rename prompt still makes sense)? */
export function isDefaultLayerName(name: string): boolean {
  return DEFAULT_RE.test(name.trim());
}
