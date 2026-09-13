/**
 * Reading and writing measurements — the one place that knows the table's
 * columns and the four ids every row carries. The viewer's single-point
 * saves still speak to the table directly (they are woven into the gesture
 * and undo code); everything that touches MANY rows at once — a sheet load,
 * an undo batch, the export, an auto-count drop — goes through here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEAS_COLS, type Measurement } from "./model";

/** Where a batch of rows belongs. */
export type MeasurementHome = {
  projectId: string;
  planFileId: string;
  sheetId: string;
  ownerId: string;
};

/** A row to insert — the measurement minus the ids the home supplies. Pass
 *  `id` to keep a client-made id (undo/redo relies on that). */
export type NewMeasurement = Omit<Measurement, "id"> & { id?: string };

export async function loadSheetMeasurements(
  sb: SupabaseClient,
  sheetId: string,
): Promise<Measurement[]> {
  const { data } = await sb
    .from("measurements")
    .select(MEAS_COLS)
    .eq("sheet_id", sheetId)
    .order("created_at", { ascending: true });
  return (data as Measurement[] | null) ?? [];
}

/** Every measurement on the given sheets, with the sheet id — the export. */
export async function loadMeasurementsForSheets(
  sb: SupabaseClient,
  sheetIds: string[],
): Promise<(Measurement & { sheet_id: string })[]> {
  if (!sheetIds.length) return [];
  const { data } = await sb
    .from("measurements")
    .select(`${MEAS_COLS},sheet_id`)
    .in("sheet_id", sheetIds);
  return (data as (Measurement & { sheet_id: string })[] | null) ?? [];
}

/** Insert many rows in one round trip. Returns the saved rows (with ids). */
export async function insertMeasurements(
  sb: SupabaseClient,
  home: MeasurementHome,
  rows: NewMeasurement[],
): Promise<{ data: Measurement[]; error: string | null }> {
  if (!rows.length) return { data: [], error: null };
  const { data, error } = await sb
    .from("measurements")
    .insert(
      rows.map((m) => ({
        ...(m.id ? { id: m.id } : {}),
        project_id: home.projectId,
        plan_file_id: home.planFileId,
        sheet_id: home.sheetId,
        owner_id: home.ownerId,
        type: m.type,
        geometry: m.geometry,
        value: m.value,
        unit: m.unit,
        layer: m.layer,
        color: m.color,
        wall_sided: m.wall_sided,
        wall_height: m.wall_height,
        vol_mode: m.vol_mode,
        vol_width: m.vol_width,
        vol_depth: m.vol_depth,
        text: m.text ?? null,
        font_size: m.font_size ?? null,
        head_size: m.head_size ?? null,
      })),
    )
    .select(MEAS_COLS);
  return { data: (data as Measurement[] | null) ?? [], error: error?.message ?? null };
}

export async function deleteMeasurements(sb: SupabaseClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await sb.from("measurements").delete().in("id", ids);
}
