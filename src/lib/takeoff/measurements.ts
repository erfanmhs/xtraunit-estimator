/**
 * Turning measurements into the numbers people read: a run's value when the
 * sheet's scale changes, its on-drawing label, and the per-layer totals that
 * feed the side panel, the on-sheet legend and the PDF export.
 *
 * Kept out of the viewer component so it can be unit-tested — these totals are
 * what a bid is built from.
 */
import { CF_PER_CY, geomLenFeet, layerKeyOf, polyAreaSqFt, type Pt } from "./geometry";

/** The measurement fields this maths needs. The viewer's row type is a superset. */
export type MeasurementLike = {
  type: string;
  geometry: Pt[];
  value: number | null;
  unit: string | null;
  layer: string | null;
  color?: string | null;
  wall_sided?: string | null;
  wall_height?: number | null;
  vol_mode?: string | null;
  vol_width?: number | null;
  vol_depth?: number | null;
};

/**
 * A measurement's value at a given scale (points per foot, per axis).
 * Counts are a tally, not a distance, so they're left alone — as is anything
 * whose type we don't measure (a leader carries text, not a quantity).
 */
export function recomputeValue(m: MeasurementLike, sx: number, sy: number): number | null {
  switch (m.type) {
    case "line":
    case "polyline":
      return geomLenFeet(m.geometry, sx, sy);
    case "area":
      return polyAreaSqFt(m.geometry, sx, sy);
    case "wall":
      return (
        geomLenFeet(m.geometry, sx, sy) *
        (m.wall_height ?? 0) *
        (m.wall_sided === "double" ? 2 : 1)
      );
    case "volume":
      return m.vol_mode === "area"
        ? polyAreaSqFt(m.geometry, sx, sy) * (m.vol_depth ?? 0)
        : geomLenFeet(m.geometry, sx, sy) * (m.vol_width ?? 0) * (m.vol_depth ?? 0);
    default:
      return m.value;
  }
}

/** The text drawn next to a run. Volumes also show cubic yards, for ordering. */
export function labelText(m: MeasurementLike): string {
  if (m.value == null) return "";
  if (m.type === "volume")
    return `${m.value.toFixed(0)} cf · ${(m.value / CF_PER_CY).toFixed(2)} cy`;
  if (m.type === "count") return `${m.value} ea`;
  return `${m.value.toFixed(1)} ${m.unit ?? ""}`;
}

export type LayerGroup<T> = {
  layer: string;
  color: string;
  rows: T[];
  units: Record<string, number>;
  /** One readable total per unit, e.g. ["412.5 sf", "3 ea"]. */
  lines: string[];
};

/**
 * Group runs into layer takeoff lines, summing each unit separately — you
 * can't add square feet to each. Order follows first appearance, so the panel
 * doesn't reshuffle while you draw.
 */
export function buildLayerGroups<T extends MeasurementLike>(measurements: T[]): LayerGroup<T>[] {
  const groups: Omit<LayerGroup<T>, "lines">[] = [];
  for (const m of measurements) {
    const key = layerKeyOf(m.layer);
    let g = groups.find((x) => x.layer === key);
    if (!g) {
      g = { layer: key, color: m.color ?? "#A01C2D", rows: [], units: {} };
      groups.push(g);
    }
    g.rows.push(m);
    if (m.value != null) {
      const unit = m.unit || "";
      g.units[unit] = (g.units[unit] ?? 0) + m.value;
    }
  }
  return groups.map((g) => ({
    ...g,
    lines: Object.entries(g.units).map(([unit, sum]) =>
      unit === "cf"
        ? `${sum.toFixed(0)} cf · ${(sum / CF_PER_CY).toFixed(2)} cy`
        : unit === "ea"
          ? `${sum} ea`
          : `${sum.toFixed(1)} ${unit}`,
    ),
  }));
}
