/**
 * The takeoff data model — what a sheet, a measurement and a tool ARE, plus
 * the constants every takeoff surface shares (scale presets, paper shapes,
 * the colour rotation, the measurement columns). Geometry is PDF points,
 * zoom-independent; scale is points per foot.
 *
 * Pulled out of PlanViewer so the viewer, the export drawing, the store and
 * the auto-count all import one definition instead of copying it.
 */
import type { Pt } from "./geometry";

export type Ledger = { x: number; y: number; scale: number; visible: boolean };
/** A cropped sheet's window onto its page: PDF points, top-left origin, page scale 1. */
export type Crop = { x: number; y: number; w: number; h: number };
export type Sheet = {
  id: string;
  page_number: number;
  name?: string | null;
  label: string | null;
  notes: string | null;
  discipline?: string | null;
  scale_x: number | null;
  scale_y: number | null;
  scale_preset: string | null;
  ledger?: Ledger | null;
  crop?: Crop | null; // migration 0035 — a sheet cut from a page, non-destructively
  source_sheet_id?: string | null;
  created_at?: string;
};

// Standard paper shapes for the Crop tool (inches). Only the SHAPE is held —
// the size is whatever you drag; the readout shows it in inches.
export const PAPER: { id: string; label: string; w: number; h: number }[] = [
  { id: "free", label: "Free", w: 0, h: 0 },
  { id: "ansi-a", label: "ANSI A · 8½×11", w: 8.5, h: 11 },
  { id: "ansi-b", label: "ANSI B · 11×17", w: 11, h: 17 },
  { id: "ansi-c", label: "ANSI C · 17×22", w: 17, h: 22 },
  { id: "ansi-d", label: "ANSI D · 22×34", w: 22, h: 34 },
  { id: "ansi-e", label: "ANSI E · 34×44", w: 34, h: 44 },
  { id: "arch-a", label: "ARCH A · 9×12", w: 9, h: 12 },
  { id: "arch-b", label: "ARCH B · 12×18", w: 12, h: 18 },
  { id: "arch-c", label: "ARCH C · 18×24", w: 18, h: 24 },
  { id: "arch-d", label: "ARCH D · 24×36", w: 24, h: 36 },
  { id: "arch-e", label: "ARCH E · 36×48", w: 36, h: 48 },
  { id: "a4", label: "A4 · 8.27×11.69", w: 8.27, h: 11.69 },
  { id: "a3", label: "A3 · 11.69×16.54", w: 11.69, h: 16.54 },
  { id: "a2", label: "A2 · 16.54×23.39", w: 16.54, h: 23.39 },
  { id: "a1", label: "A1 · 23.39×33.11", w: 23.39, h: 33.11 },
];
export const PT_PER_IN = 72;

export const DEFAULT_LEDGER: Ledger = { x: 0.7, y: 0.04, scale: 1, visible: false };
// Base ledger size in PDF points (then × page zoom × the user's size multiplier).
export const LEDGER_BASE_W = 200;
export const LEDGER_BASE_FONT = 11;
export type Measurement = {
  id: string;
  type: string;
  geometry: Pt[];
  value: number | null;
  unit: string | null;
  layer: string | null;
  color: string | null;
  wall_sided: string | null;
  wall_height: number | null;
  vol_mode: string | null;
  vol_width: number | null;
  vol_depth: number | null;
  // Leader-only: the text note + its arrowhead/font sizes (PDF points).
  text?: string | null;
  font_size?: number | null;
  head_size?: number | null;
};
export type Tool =
  | "browse"
  | "select"
  | "calibrate"
  | "line"
  | "polyline"
  | "area"
  | "wall"
  | "volume"
  | "count"
  | "leader"
  | "crop";

export const MEAS_COLS =
  "id,type,geometry,value,unit,layer,color,wall_sided,wall_height,vol_mode,vol_width,vol_depth,text,font_size,head_size";
// Leader annotation defaults (PDF points). User grows/shrinks each per leader.
export const LEADER_FONT_DEFAULT = 14;
export const LEADER_HEAD_DEFAULT = 12;

export const PRESETS: { label: string; inPerFt: number; group: string }[] = [
  { label: '3"=1\'', inPerFt: 3, group: "Architectural" },
  { label: '1-1/2"=1\'', inPerFt: 1.5, group: "Architectural" },
  { label: '1"=1\'', inPerFt: 1, group: "Architectural" },
  { label: '3/4"=1\'', inPerFt: 0.75, group: "Architectural" },
  { label: '1/2"=1\'', inPerFt: 0.5, group: "Architectural" },
  { label: '1/4"=1\'', inPerFt: 0.25, group: "Architectural" },
  { label: '3/16"=1\'', inPerFt: 0.1875, group: "Architectural" },
  { label: '1/8"=1\'', inPerFt: 0.125, group: "Architectural" },
  { label: '1/16"=1\'', inPerFt: 0.0625, group: "Architectural" },
  { label: '1"=10\'', inPerFt: 0.1, group: "Civil" },
  { label: '1"=20\'', inPerFt: 0.05, group: "Civil" },
  { label: '1"=30\'', inPerFt: 1 / 30, group: "Civil" },
  { label: '1"=40\'', inPerFt: 0.025, group: "Civil" },
  { label: '1"=50\'', inPerFt: 0.02, group: "Civil" },
  { label: '1"=100\'', inPerFt: 0.01, group: "Civil" },
];
// 12 distinct colors — each new tool pick auto-rotates to an unused one.
export const COLORS = [
  "#A01C2D",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#6366f1",
  "#0d9488",
  "#ca8a04",
];
export const MEASURE_TOOLS: Tool[] = [
  "line",
  "polyline",
  "area",
  "wall",
  "volume",
  "count",
  "leader",
];
