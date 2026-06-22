"use client";

/**
 * In-app plan viewer + takeoff.
 * Browse/zoom/pan, per-sheet notes, scale (preset or manual calibration),
 * the Line measure tool, and a Select tool to pick / move / edit / duplicate /
 * delete individual measurements. Geometry is stored in PDF points
 * (zoom-independent); scale is points-per-foot.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";
import { getPdfjs } from "@/lib/pdfClient";
import type { PlanFile } from "@/types";

// On-sheet takeoff legend placement (fractions of the page + a size multiplier).
type Ledger = { x: number; y: number; scale: number; visible: boolean };
type Sheet = {
  id: string;
  page_number: number;
  name?: string | null;
  label: string | null;
  notes: string | null;
  scale_x: number | null;
  scale_y: number | null;
  scale_preset: string | null;
  ledger?: Ledger | null;
};
type Pt = { x: number; y: number };

const DEFAULT_LEDGER: Ledger = { x: 0.7, y: 0.04, scale: 1, visible: false };
// Base ledger size in PDF points (then × page zoom × the user's size multiplier).
const LEDGER_BASE_W = 200;
const LEDGER_BASE_FONT = 11;
type Measurement = {
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
type Tool =
  | "browse"
  | "select"
  | "calibrate"
  | "line"
  | "polyline"
  | "area"
  | "wall"
  | "volume"
  | "count"
  | "leader";

const MEAS_COLS =
  "id,type,geometry,value,unit,layer,color,wall_sided,wall_height,vol_mode,vol_width,vol_depth,text,font_size,head_size";
const CF_PER_CY = 27;
// Leader annotation defaults (PDF points). User grows/shrinks each per leader.
const LEADER_FONT_DEFAULT = 14;
const LEADER_HEAD_DEFAULT = 12;

// Recompute a measurement's value for a given scale (points-per-foot).
// Count is independent of scale, so its value is left untouched.
function recomputeValue(m: Measurement, sx: number, sy: number): number | null {
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
        : geomLenFeet(m.geometry, sx, sy) *
            (m.vol_width ?? 0) *
            (m.vol_depth ?? 0);
    default:
      return m.value;
  }
}

function labelText(m: Measurement): string {
  if (m.value == null) return "";
  if (m.type === "volume")
    return `${m.value.toFixed(0)} cf · ${(m.value / CF_PER_CY).toFixed(2)} cy`;
  if (m.type === "count") return `${m.value} ea`;
  return `${m.value.toFixed(1)} ${m.unit ?? ""}`;
}

const PRESETS: { label: string; inPerFt: number; group: string }[] = [
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
const COLORS = [
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
const MEASURE_TOOLS: Tool[] = [
  "line",
  "polyline",
  "area",
  "wall",
  "volume",
  "count",
  "leader",
];
// Layers group by trimmed name; unnamed measurements share the "Unlabeled" group.
function layerKeyOf(layer: string | null): string {
  return (layer ?? "").trim() || "Unlabeled";
}

function segFeet(a: Pt, b: Pt, sx: number, sy: number): number {
  return Math.hypot((b.x - a.x) / sx, (b.y - a.y) / sy);
}
function geomLenFeet(g: Pt[], sx: number, sy: number): number {
  let t = 0;
  for (let i = 1; i < g.length; i++) t += segFeet(g[i - 1], g[i], sx, sy);
  return t;
}
// Polygon area in square feet (shoelace), honoring separate H/V scales.
function polyAreaSqFt(g: Pt[], sx: number, sy: number): number {
  if (g.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < g.length; i++) {
    const p = g[i];
    const q = g[(i + 1) % g.length];
    a += (p.x / sx) * (q.y / sy) - (q.x / sx) * (p.y / sy);
  }
  return Math.abs(a) / 2;
}
function pointInPoly(p: Pt, g: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const a = g[i];
    const b = g[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Group measurements into layer takeoff lines (shared by the side panel, the
// on-sheet legend, and the PDF export).
function buildLayerGroups(measurements: Measurement[]) {
  const groups: {
    layer: string;
    color: string;
    rows: Measurement[];
    units: Record<string, number>;
  }[] = [];
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

function hexToRgba(hex: string, a: number): string {
  const h = (hex || "#A01C2D").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

// Draw all takeoff markup onto a 2D canvas at exportScale k (PDF points × k).
// Mirrors the on-screen SVG overlay so exports look like the live sheet.
function drawMarkupOnCanvas(
  ctx: CanvasRenderingContext2D,
  ms: Measurement[],
  k: number,
) {
  const P = (p: Pt) => ({ x: p.x * k, y: p.y * k });
  for (const m of ms) {
    const col = m.color ?? "#A01C2D";
    const g = m.geometry;
    if (!g || !g.length) continue;
    if (m.type === "count") {
      for (const v of g) {
        const c = P(v);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5 * k, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(col, 0.85);
        ctx.fill();
        ctx.lineWidth = 1.2 * k;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    } else {
      const filled =
        m.type === "area" || (m.type === "volume" && m.vol_mode === "area");
      ctx.beginPath();
      g.forEach((p, i) => {
        const c = P(p);
        if (i) ctx.lineTo(c.x, c.y);
        else ctx.moveTo(c.x, c.y);
      });
      if (filled) {
        ctx.closePath();
        ctx.fillStyle = hexToRgba(col, 0.15);
        ctx.fill();
      }
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = col;
      ctx.stroke();
      if (m.type === "leader" && g.length >= 2) {
        const head = P(g[0]);
        const box = P(g[1]);
        const ang = Math.atan2(head.y - box.y, head.x - box.x);
        const hs = (m.head_size ?? LEADER_HEAD_DEFAULT) * k;
        ctx.beginPath();
        ctx.moveTo(head.x, head.y);
        ctx.lineTo(head.x - hs * Math.cos(ang - 0.42), head.y - hs * Math.sin(ang - 0.42));
        ctx.lineTo(head.x - hs * Math.cos(ang + 0.42), head.y - hs * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        const fs = (m.font_size ?? LEADER_FONT_DEFAULT) * k;
        ctx.font = `600 ${fs}px sans-serif`;
        ctx.textBaseline = "alphabetic";
        (m.text ?? "").split("\n").forEach((ln, i) => {
          const ty = box.y + i * fs * 1.15;
          ctx.lineWidth = Math.max(2, fs * 0.16);
          ctx.strokeStyle = "#fff";
          ctx.strokeText(ln, box.x + 5 * k, ty);
          ctx.fillStyle = col;
          ctx.fillText(ln, box.x + 5 * k, ty);
        });
      }
    }
    const text = labelText(m);
    if (text) {
      const centered =
        m.type === "area" ||
        m.type === "count" ||
        (m.type === "volume" && m.vol_mode === "area");
      const anchor = centered
        ? {
            x: g.reduce((s, p) => s + p.x, 0) / g.length,
            y: g.reduce((s, p) => s + p.y, 0) / g.length,
          }
        : g.length >= 2
          ? { x: (g[0].x + g[1].x) / 2, y: (g[0].y + g[1].y) / 2 }
          : g[0];
      const a = P(anchor);
      const fs = 14 * k;
      ctx.font = `700 ${fs}px sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3.5 * k;
      ctx.strokeStyle = "#000";
      ctx.strokeText(text, a.x + 6 * k, a.y - 6 * k);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, a.x + 6 * k, a.y - 6 * k);
    }
  }
}

// Draw the takeoff legend onto the export canvas (matches the on-sheet box).
function drawLedgerOnCanvas(
  ctx: CanvasRenderingContext2D,
  ms: Measurement[],
  k: number,
  ledger: Ledger | null | undefined,
  cw: number,
  ch: number,
) {
  if (!ledger?.visible) return;
  const rows = buildLayerGroups(ms).filter((g) => g.lines.length > 0);
  if (!rows.length) return;
  const sc = ledger.scale * k;
  const W = LEDGER_BASE_W * sc;
  const font = LEDGER_BASE_FONT * sc;
  const pad = 6 * sc;
  const rowH = font * 1.5 + 4 * sc;
  const headH = font + 2 * pad;
  const H = headH + rows.length * rowH + 4 * sc;
  let x = ledger.x * cw;
  let y = ledger.y * ch;
  x = Math.max(2, Math.min(x, cw - W - 2));
  y = Math.max(2, Math.min(y, ch - H - 2));
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(x, y, W, H);
  ctx.lineWidth = Math.max(1, sc);
  ctx.strokeStyle = "#888";
  ctx.strokeRect(x, y, W, H);
  ctx.fillStyle = "#eef0f2";
  ctx.fillRect(x, y, W, headH);
  ctx.strokeRect(x, y, W, headH);
  ctx.fillStyle = "#111";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${font}px sans-serif`;
  ctx.fillText("Takeoff Legend", x + pad, y + headH / 2);
  let ry = y + headH;
  for (const r of rows) {
    const sw = font * 0.7;
    ctx.fillStyle = r.color;
    ctx.fillRect(x + pad, ry + rowH / 2 - sw / 2, sw, sw);
    ctx.fillStyle = "#111";
    ctx.font = `${font}px sans-serif`;
    const txt = `${r.layer} — ${r.lines.join(", ")} · ${r.rows.length} run${r.rows.length === 1 ? "" : "s"}`;
    ctx.fillText(txt, x + pad * 2 + sw, ry + rowH / 2, W - pad * 3 - sw);
    ry += rowH;
  }
}

export default function PlanViewer({
  projectId,
  planFile,
  sheets,
}: {
  projectId: string;
  planFile: PlanFile;
  sheets: Sheet[];
}) {
  const [supabase] = useState(() => createClient());
  const ranRef = useRef(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  // fx/fy: cursor as a fraction of the page (scale-independent). vx/vy: cursor
  // position within the viewport. Used to keep that page point under the cursor.
  const focusRef = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<{ id: string; index: number; pointerId: number } | null>(null);
  const finalizingRef = useRef(false);
  const activeCountRef = useRef<{ id: string; geometry: Pt[] } | null>(null);
  const pendingCenterRef = useRef(true); // center the page on load / page change
  const panMovedRef = useRef(false); // distinguishes a right-drag (pan) from a right-click (menu)
  const router = useRouter();

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1); // live display zoom
  const [rasterScale, setRasterScale] = useState(1); // scale the bitmap is drawn at
  const [baseDims, setBaseDims] = useState({ w: 0, h: 0 }); // page size at scale 1
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 }); // viewport size (for canvas padding)

  // Adjustable panels + floating notes
  const [navOpen, setNavOpen] = useState(true);
  const [navW, setNavW] = useState(208);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelW, setPanelW] = useState(268);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  // Export-to-PDF dialog state.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSel, setExportSel] = useState<Set<string>>(new Set());
  const [markedSheets, setMarkedSheets] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportLegend, setExportLegend] = useState(true);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: "measurement" | "canvas" | "sheet";
    id?: string;
  } | null>(null);
  const [sheetNames, setSheetNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(sheets.map((s) => [s.id, s.name ?? ""])),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(sheets.map((s) => [s.id, s.notes ?? ""])),
  );
  const [scales, setScales] = useState<
    Record<string, { x: number | null; y: number | null; preset: string | null }>
  >(() =>
    Object.fromEntries(
      sheets.map((s) => [s.id, { x: s.scale_x, y: s.scale_y, preset: s.scale_preset }]),
    ),
  );
  const [notesSaved, setNotesSaved] = useState(false);
  const [ledgers, setLedgers] = useState<Record<string, Ledger>>(() =>
    Object.fromEntries(sheets.map((s) => [s.id, s.ledger ?? DEFAULT_LEDGER])),
  );
  const ledgerSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [layer, setLayer] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [wallHeight, setWallHeight] = useState("8");
  const [wallSided, setWallSided] = useState<"single" | "double">("single");
  const [volMode, setVolMode] = useState<"linear" | "area">("linear");
  const [volWidth, setVolWidth] = useState("1.5");
  const [volDepth, setVolDepth] = useState("1");
  const [calib, setCalib] = useState<{ p1: Pt; p2: Pt } | null>(null);
  const [calibFeet, setCalibFeet] = useState("");
  const [calibAxis, setCalibAxis] = useState<"h" | "v">("h");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [editGeom, setEditGeom] = useState<Pt[] | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Layer groups: hidden layers stay saved but don't render. One layer at a
  // time can be open in the panel's layer editor (rename / attrs / delete) —
  // individual runs are edited by clicking them on the drawing itself.
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [editingLayer, setEditingLayer] = useState<string | null>(null);
  const [layerName, setLayerName] = useState("");
  const [layerHeight, setLayerHeight] = useState("");
  const [layerSided, setLayerSided] = useState<"single" | "double">("single");
  const [layerVolW, setLayerVolW] = useState("");
  const [layerVolD, setLayerVolD] = useState("");

  const currentSheet = sheets.find((s) => s.page_number === pageNum) ?? null;
  const currentScale = currentSheet ? scales[currentSheet.id] : null;
  const currentLedger = currentSheet
    ? (ledgers[currentSheet.id] ?? DEFAULT_LEDGER)
    : null;
  const hasScale = !!(currentScale?.x && currentScale?.y);
  const selected = measurements.find((m) => m.id === selectedId) ?? null;
  // A measuring tool was picked on a sheet with no scale → block with a prompt.
  const needsScale =
    !hasScale &&
    (tool === "line" ||
      tool === "polyline" ||
      tool === "area" ||
      tool === "wall" ||
      tool === "volume");

  // Load the PDF once.
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    (async () => {
      try {
        const { data, error: dErr } = await supabase.storage
          .from("plans")
          .download(planFile.storage_path);
        if (dErr || !data) throw dErr ?? new Error("Could not download file.");
        const pdfjs = await getPdfjs();
        const pdf = await pdfjs.getDocument({
          data: await data.arrayBuffer(),
          standardFontDataUrl: "/standard_fonts/",
        }).promise;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open this plan.");
        setStatus("error");
      }
    })();
  }, [supabase, planFile.storage_path]);

  // Load measurements per sheet; reset transient state.
  useEffect(() => {
    setDraft([]);
    setHover(null);
    setCalib(null);
    setSelectedId(null);
    setEditGeom(null);
    activeCountRef.current = null;
    setActiveCountId(null);
    if (!currentSheet) return;
    (async () => {
      const { data } = await supabase
        .from("measurements")
        .select(MEAS_COLS)
        .eq("sheet_id", currentSheet.id);
      setMeasurements((data as Measurement[]) ?? []);
    })();
  }, [supabase, currentSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitWidth = useCallback(async () => {
    const pdf = pdfRef.current;
    const box = viewportRef.current;
    if (!pdf || !box) return;
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const next = Math.max(0.1, Math.min((box.clientWidth - 48) / base.width, 4));
    setBaseDims({ w: base.width, h: base.height });
    pendingCenterRef.current = true;
    setScale(next);
    setRasterScale(next);
  }, [pageNum]);

  // Track the viewport size so the canvas can be padded by a full viewport on
  // every side (an "infinite canvas" — the page can be scrolled anywhere).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const update = () => setVpSize({ w: vp.clientWidth, h: vp.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  // Re-center when switching sheets/pages.
  useEffect(() => {
    pendingCenterRef.current = true;
  }, [pageNum]);

  useEffect(() => {
    if (status === "ready") fitWidth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Render current page.
  useEffect(() => {
    if (status !== "ready" || !pdfRef.current) return;
    let cancelled = false;
    (async () => {
      const pdf = pdfRef.current!;
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setBaseDims({ w: base.width, h: base.height });
      const viewport = page.getViewport({ scale: rasterScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      if (taskRef.current) {
        try {
          taskRef.current.cancel();
        } catch {}
      }
      const task = page.render({ canvasContext: ctx, viewport });
      taskRef.current = task;
      try {
        await task.promise;
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [status, pageNum, rasterScale]);

  // Wheel zoom toward cursor; block middle-button autoscroll.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const crect = canvas.getBoundingClientRect();
      const vrect = vp!.getBoundingClientRect();
      // Record the page point under the cursor as a fraction of the page, so it
      // maps correctly at any scale, plus where the cursor sits in the viewport.
      focusRef.current = {
        fx: crect.width ? (e.clientX - crect.left) / crect.width : 0.5,
        fy: crect.height ? (e.clientY - crect.top) / crect.height : 0.5,
        vx: e.clientX - vrect.left,
        vy: e.clientY - vrect.top,
      };
      setScale((prev) =>
        Math.max(0.1, Math.min(6, prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15))),
      );
    }
    function onMouseDown(e: MouseEvent) {
      if (e.button === 1) e.preventDefault();
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("mousedown", onMouseDown);
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  // Re-anchor the cursor's point after a zoom. Runs synchronously with the
  // scale change (the display size is CSS-driven, not waiting on a re-render),
  // so the drawing stays put under the cursor instead of lurching.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const canvas = canvasRef.current;
    if (!vp || !canvas || !baseDims.w) return;
    const crect = canvas.getBoundingClientRect();
    const vrect = vp.getBoundingClientRect();
    // The page's top-left in scroll-content coordinates (measured, so it stays
    // correct no matter where the page sits or how it's padded).
    const originX = crect.left - vrect.left + vp.scrollLeft;
    const originY = crect.top - vrect.top + vp.scrollTop;
    if (pendingCenterRef.current) {
      vp.scrollLeft = originX + crect.width / 2 - vp.clientWidth / 2;
      vp.scrollTop = originY + crect.height / 2 - vp.clientHeight / 2;
      pendingCenterRef.current = false;
      focusRef.current = null;
      return;
    }
    const f = focusRef.current;
    if (!f) return;
    // Keep the page point that was under the cursor under the cursor.
    vp.scrollLeft = originX + f.fx * crect.width - f.vx;
    vp.scrollTop = originY + f.fy * crect.height - f.vy;
    focusRef.current = null;
  }, [scale, pageNum, baseDims.w, baseDims.h, vpSize.w, vpSize.h]);

  // After zooming settles, re-rasterize the page crisply at the new scale. The
  // display size is already correct, so this swap causes no visual jump.
  useEffect(() => {
    if (scale === rasterScale) return;
    const t = setTimeout(() => setRasterScale(scale), 160);
    return () => clearTimeout(t);
  }, [scale, rasterScale]);

  // Keyboard: Esc cancels/steps back, Delete removes selection, Space pans.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);

      if (e.key === "Escape") {
        if (menu) {
          setMenu(null);
        } else if (draft.length) {
          setDraft([]);
          setHover(null);
        } else if (activeCountId) {
          finishCount();
        } else if (calib) {
          setCalib(null);
        } else if (tool !== "select") {
          setTool("select");
        } else if (selectedId) {
          setSelectedId(null);
        }
        el?.blur?.();
        return;
      }
      if (!typing && (e.key === "Delete") && selectedId) {
        deleteMeasurement(selectedId);
        return;
      }
      if (!typing && e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [draft.length, calib, tool, selectedId, activeCountId, menu]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- notes ----
  // Drag a divider to resize a side panel (window listeners keep it smooth).
  function startResize(side: "left" | "right", e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? navW : panelW;
    const handle = e.currentTarget as HTMLElement;
    handle.setAttribute("data-active", "true");
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (side === "left") {
        setNavW(Math.max(150, Math.min(440, startW + dx)));
      } else {
        setPanelW(Math.max(200, Math.min(520, startW - dx)));
      }
    };
    const onUp = () => {
      handle.removeAttribute("data-active");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function sheetTitle(s: Sheet): string {
    return (sheetNames[s.id] || "").trim() || `Sheet ${s.page_number}`;
  }
  async function saveSheetName(id: string, value: string) {
    setSheetNames((p) => ({ ...p, [id]: value }));
    await supabase
      .from("sheets")
      .update({ name: value.trim() || null })
      .eq("id", id);
  }

  async function saveNotes(value: string) {
    if (!currentSheet) return;
    await supabase.from("sheets").update({ notes: value }).eq("id", currentSheet.id);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1500);
  }
  function onNotesChange(value: string) {
    if (!currentSheet) return;
    const id = currentSheet.id;
    setNotes((p) => ({ ...p, [id]: value }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNotes(value), 800);
  }

  // ---- scale ----
  // Re-value every measurement on the current sheet for a new scale, and persist
  // the ones that changed. Count measurements are unaffected.
  async function recomputeAllForScale(sx: number, sy: number) {
    const next = measurements.map((m) =>
      m.type === "count" ? m : { ...m, value: recomputeValue(m, sx, sy) },
    );
    setMeasurements(next);
    const changed = next.filter((m, i) => m.value !== measurements[i].value);
    await Promise.all(
      changed.map((m) =>
        supabase.from("measurements").update({ value: m.value }).eq("id", m.id),
      ),
    );
  }

  async function applyPreset(label: string) {
    if (!currentSheet) return;
    if (!label) {
      setScales((p) => ({ ...p, [currentSheet.id]: { x: null, y: null, preset: null } }));
      await supabase
        .from("sheets")
        .update({ scale_x: null, scale_y: null, scale_preset: null })
        .eq("id", currentSheet.id);
      return;
    }
    const preset = PRESETS.find((p) => p.label === label);
    if (!preset) return;
    const ppf = preset.inPerFt * 72;
    setScales((p) => ({ ...p, [currentSheet.id]: { x: ppf, y: ppf, preset: label } }));
    await supabase
      .from("sheets")
      .update({ scale_x: ppf, scale_y: ppf, scale_preset: label, scale_unit: "ft" })
      .eq("id", currentSheet.id);
    recomputeAllForScale(ppf, ppf);
  }

  async function applyCalibration() {
    if (!currentSheet || !calib) return;
    const feet = parseFloat(calibFeet);
    if (!(feet > 0)) return;
    const dx = Math.abs(calib.p2.x - calib.p1.x);
    const dy = Math.abs(calib.p2.y - calib.p1.y);
    const ppf = (calibAxis === "h" ? dx : dy) / feet;
    const prev = scales[currentSheet.id] ?? { x: null, y: null, preset: null };
    const next =
      calibAxis === "h"
        ? { x: ppf, y: prev.y ?? ppf, preset: null }
        : { x: prev.x ?? ppf, y: ppf, preset: null };
    setScales((p) => ({ ...p, [currentSheet.id]: next }));
    await supabase
      .from("sheets")
      .update({ scale_x: next.x, scale_y: next.y, scale_preset: null, scale_unit: "ft" })
      .eq("id", currentSheet.id);
    if (next.x && next.y) recomputeAllForScale(next.x, next.y);
    setCalib(null);
    setCalibFeet("");
    setTool("select");
  }

  // ---- geometry helpers ----
  // Auto-rotate to a color no measurement on this sheet is using yet.
  function pickNextColor(): string {
    const used = new Set<string>(
      measurements.map((m) => m.color ?? "").filter(Boolean),
    );
    used.add(color);
    return (
      COLORS.find((c) => !used.has(c)) ??
      COLORS[(measurements.length + 1) % COLORS.length]
    );
  }

  // Selecting a measure tool starts fresh: empty layer name, new color.
  function selectTool(t: Tool) {
    setTool(t);
    setDraft([]);
    setHover(null);
    finishCount();
    if (MEASURE_TOOLS.includes(t)) {
      setLayer("");
      setColor(pickNextColor());
    }
  }

  // "Digitizer" continue: re-arm a layer group so new draws keep adding to it.
  function continueLayer(g: { layer: string; color: string; rows: Measurement[] }) {
    const first = g.rows[0];
    finishCount();
    setLayer(g.layer === "Unlabeled" ? "" : g.layer);
    setColor(g.color);
    if (first.type === "wall") {
      setWallHeight(String(first.wall_height ?? 8));
      setWallSided((first.wall_sided as "single" | "double") ?? "single");
    }
    if (first.type === "volume") {
      setVolMode((first.vol_mode as "linear" | "area") ?? "linear");
      setVolWidth(String(first.vol_width ?? 1.5));
      setVolDepth(String(first.vol_depth ?? 1));
    }
    if (first.type === "count") {
      // Counts continue the SAME record — new clicks add markers to it.
      activeCountRef.current = { id: first.id, geometry: first.geometry };
      setActiveCountId(first.id);
    }
    setDraft([]);
    setHover(null);
    setTool(first.type as Tool);
  }

  function evtToPoint(e: React.PointerEvent): Pt {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }
  const TOL = () => 8 / scale; // selection tolerance, in points

  async function insertMeasurement(
    type: string,
    geometry: Pt[],
    value: number,
    unit = "ft",
    extra: Partial<Measurement> = {},
  ) {
    if (!currentSheet) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error: insErr } = await supabase
      .from("measurements")
      .insert({
        project_id: projectId,
        plan_file_id: planFile.id,
        sheet_id: currentSheet.id,
        owner_id: user.id,
        type,
        geometry,
        value,
        unit,
        layer: layer || null,
        color,
        ...extra,
      })
      .select(MEAS_COLS)
      .single();
    setDraft([]);
    setHover(null);
    if (insErr || !data) {
      setError("Could not save that measurement.");
      return;
    }
    setMeasurements((m) => [...m, data as Measurement]);
  }

  function finalizeLine(p0: Pt, p1: Pt) {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (!currentScale?.x || !currentScale?.y) {
      setError("Set a scale first (preset above, or Calibrate).");
      setDraft([]);
      return;
    }
    insertMeasurement("line", [p0, p1], segFeet(p0, p1, currentScale.x, currentScale.y));
  }

  // A leader: an arrow whose tip (geometry[0]) points at something and whose
  // text box (geometry[1]) holds a note. No scale needed; value stays null.
  function finalizeLeader(head: Pt, box: Pt) {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    insertLeader([head, box]);
  }

  async function insertLeader(geometry: Pt[]) {
    if (!currentSheet) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error: insErr } = await supabase
      .from("measurements")
      .insert({
        project_id: projectId,
        plan_file_id: planFile.id,
        sheet_id: currentSheet.id,
        owner_id: user.id,
        type: "leader",
        geometry,
        value: null,
        unit: null,
        layer: layer || null,
        color,
        text: "",
        font_size: LEADER_FONT_DEFAULT,
        head_size: LEADER_HEAD_DEFAULT,
      })
      .select(MEAS_COLS)
      .single();
    setDraft([]);
    setHover(null);
    if (insErr || !data) {
      setError("Could not add the leader. (Has migration 0023 been run?)");
      return;
    }
    // Drop straight into Select so the user can type the note in the panel.
    const md = data as Measurement;
    setMeasurements((m) => [...m, md]);
    setTool("select");
    setSelectedId(md.id);
  }

  function finalizePolyline(g: Pt[]) {
    if (g.length < 2) return;
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (!currentScale?.x || !currentScale?.y) {
      setError("Set a scale first (preset above, or Calibrate).");
      setDraft([]);
      return;
    }
    insertMeasurement("polyline", g, geomLenFeet(g, currentScale.x, currentScale.y));
  }

  function finalizeArea(g: Pt[]) {
    if (g.length < 3) return;
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (!currentScale?.x || !currentScale?.y) {
      setError("Set a scale first (preset above, or Calibrate).");
      setDraft([]);
      return;
    }
    insertMeasurement("area", g, polyAreaSqFt(g, currentScale.x, currentScale.y), "sf");
  }

  function finalizeWall(g: Pt[]) {
    if (g.length < 2) return;
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (!currentScale?.x || !currentScale?.y) {
      setError("Set a scale first (preset above, or Calibrate).");
      setDraft([]);
      return;
    }
    const h = parseFloat(wallHeight);
    if (!(h > 0)) {
      setError("Enter a wall height (feet) first.");
      setDraft([]);
      return;
    }
    const sides = wallSided === "double" ? 2 : 1;
    const area = geomLenFeet(g, currentScale.x, currentScale.y) * h * sides;
    insertMeasurement("wall", g, area, "sf", {
      wall_sided: wallSided,
      wall_height: h,
    });
  }

  function finalizeVolume(g: Pt[]) {
    if (g.length < (volMode === "area" ? 3 : 2)) return;
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (!currentScale?.x || !currentScale?.y) {
      setError("Set a scale first (preset above, or Calibrate).");
      setDraft([]);
      return;
    }
    const depth = parseFloat(volDepth);
    if (!(depth > 0)) {
      setError("Enter a depth (feet) first.");
      setDraft([]);
      return;
    }
    let cf: number;
    let width: number | null = null;
    if (volMode === "area") {
      cf = polyAreaSqFt(g, currentScale.x, currentScale.y) * depth;
    } else {
      width = parseFloat(volWidth);
      if (!(width > 0)) {
        setError("Enter a width (feet) first.");
        setDraft([]);
        return;
      }
      cf = geomLenFeet(g, currentScale.x, currentScale.y) * width * depth;
    }
    insertMeasurement("volume", g, cf, "cf", {
      vol_mode: volMode,
      vol_width: width,
      vol_depth: depth,
    });
  }

  // Count needs no scale and auto-saves on every click. The first click on a
  // sheet creates the record; each later click appends a marker (or removes one
  // if you click an existing marker). Nothing is ever lost mid-count.
  async function addCountMarker(pt: Pt) {
    if (!currentSheet) return;
    const active = activeCountRef.current;
    if (active) {
      const idx = active.geometry.findIndex(
        (v) => Math.hypot(v.x - pt.x, v.y - pt.y) <= TOL() * 1.6,
      );
      const geometry =
        idx >= 0
          ? active.geometry.filter((_, i) => i !== idx)
          : [...active.geometry, pt];
      if (geometry.length === 0) {
        activeCountRef.current = null;
        setActiveCountId(null);
        setMeasurements((arr) => arr.filter((x) => x.id !== active.id));
        await supabase.from("measurements").delete().eq("id", active.id);
        return;
      }
      activeCountRef.current = { id: active.id, geometry };
      const value = geometry.length;
      setMeasurements((arr) =>
        arr.map((x) => (x.id === active.id ? { ...x, geometry, value } : x)),
      );
      await supabase
        .from("measurements")
        .update({ geometry, value })
        .eq("id", active.id);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const geometry = [pt];
    const { data } = await supabase
      .from("measurements")
      .insert({
        project_id: projectId,
        plan_file_id: planFile.id,
        sheet_id: currentSheet.id,
        owner_id: user.id,
        type: "count",
        geometry,
        value: 1,
        unit: "ea",
        layer: layer || null,
        color,
      })
      .select(MEAS_COLS)
      .single();
    if (data) {
      const md = data as Measurement;
      activeCountRef.current = { id: md.id, geometry };
      setActiveCountId(md.id);
      setMeasurements((m) => [...m, md]);
    }
  }

  function finishCount() {
    activeCountRef.current = null;
    setActiveCountId(null);
  }

  // Nearest measurement under a point (in PDF points), or null. Shared by the
  // Select tool and the right-click menu.
  function pickMeasurementAt(pt: Pt): string | null {
    let best: { id: string; d: number } | null = null;
    for (const m of measurements) {
      if (hiddenLayers.has(layerKeyOf(m.layer))) continue; // hidden = not clickable
      const g = m.geometry;
      if (m.type === "count") {
        for (const v of g) {
          const d = Math.hypot(v.x - pt.x, v.y - pt.y);
          if (!best || d < best.d) best = { id: m.id, d };
        }
        continue;
      }
      const filled =
        m.type === "area" || (m.type === "volume" && m.vol_mode === "area");
      if (filled && g.length >= 3 && pointInPoly(pt, g)) {
        best = { id: m.id, d: 0 };
        continue;
      }
      if (g.length === 1) {
        const d = Math.hypot(g[0].x - pt.x, g[0].y - pt.y);
        if (!best || d < best.d) best = { id: m.id, d };
      }
      for (let i = 1; i < g.length; i++) {
        const d = distToSeg(pt, g[i - 1], g[i]);
        if (!best || d < best.d) best = { id: m.id, d };
      }
      if (filled && g.length >= 3) {
        const d = distToSeg(pt, g[g.length - 1], g[0]);
        if (!best || d < best.d) best = { id: m.id, d };
      }
    }
    return best && best.d <= TOL() ? best.id : null;
  }

  // ---- pointer handling on the overlay ----
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || spaceHeld) return; // middle/right + space-pan bubble to pan
    const pt = evtToPoint(e);

    if (tool === "select") {
      // grab a vertex handle of the selected measurement?
      if (selected) {
        for (let i = 0; i < selected.geometry.length; i++) {
          const v = selected.geometry[i];
          if (Math.hypot(v.x - pt.x, v.y - pt.y) <= TOL() * 1.6) {
            dragRef.current = { id: selected.id, index: i, pointerId: e.pointerId };
            setEditGeom(selected.geometry.map((q) => ({ ...q })));
            try {
              svgRef.current?.setPointerCapture(e.pointerId);
            } catch {}
            return;
          }
        }
      }
      setSelectedId(pickMeasurementAt(pt));
      return;
    }

    if (tool === "browse") return;

    // starting a fresh shape clears the finalize dedupe guard
    if (draft.length === 0) finalizingRef.current = false;

    // draw tools
    if (tool === "count") {
      addCountMarker(pt);
      return;
    }
    if (
      tool === "polyline" ||
      tool === "area" ||
      tool === "wall" ||
      tool === "volume"
    ) {
      if (draft.length === 0) {
        setDraft([pt]);
        return;
      }
      const fillShape = tool === "area" || (tool === "volume" && volMode === "area");
      const minPts = fillShape ? 3 : 2;
      const last = draft[draft.length - 1];
      const first = draft[0];
      const nearLast = Math.hypot(last.x - pt.x, last.y - pt.y) <= TOL() * 1.6;
      const nearFirst = Math.hypot(first.x - pt.x, first.y - pt.y) <= TOL() * 1.6;
      // click the last vertex (incl. a double-click), or the first vertex to
      // close a filled shape, finishes the run
      if (draft.length >= minPts && (nearLast || nearFirst)) {
        if (tool === "area") finalizeArea(draft);
        else if (tool === "wall") finalizeWall(draft);
        else if (tool === "volume") finalizeVolume(draft);
        else finalizePolyline(draft);
      } else {
        setDraft((d) => [...d, pt]);
      }
      return;
    }
    if (draft.length === 0) {
      setDraft([pt]);
      return;
    }
    const p0 = draft[0];
    if (tool === "line") finalizeLine(p0, pt);
    else if (tool === "leader") finalizeLeader(p0, pt);
    else if (tool === "calibrate") {
      setCalib({ p1: p0, p2: pt });
      setDraft([]);
      setHover(null);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (tool === "select") {
      if (dragRef.current) {
        const pt = evtToPoint(e);
        setEditGeom((g) => {
          if (!g) return g;
          const ng = g.map((q) => ({ ...q }));
          ng[dragRef.current!.index] = pt;
          return ng;
        });
      }
      return;
    }
    if (tool === "browse" || draft.length === 0) return;
    setHover(evtToPoint(e));
  }

  function onDoubleClick() {
    if (tool === "polyline" && draft.length >= 2) finalizePolyline(draft);
    else if (tool === "area" && draft.length >= 3) finalizeArea(draft);
    else if (tool === "wall" && draft.length >= 2) finalizeWall(draft);
    else if (tool === "volume") {
      if (draft.length >= (volMode === "area" ? 3 : 2)) finalizeVolume(draft);
    }
  }

  async function onPointerUp() {
    if (tool === "select" && dragRef.current && editGeom) {
      const id = dragRef.current.id;
      dragRef.current = null;
      const m = measurements.find((x) => x.id === id);
      const geometry = editGeom;
      setEditGeom(null);
      if (m) {
        let value = m.value;
        if (m.type === "leader") {
          value = null; // leaders carry text, not a measured value
        } else if (m.type === "count") {
          value = geometry.length;
        } else if (currentScale?.x && currentScale?.y) {
          value =
            m.type === "area"
              ? polyAreaSqFt(geometry, currentScale.x, currentScale.y)
              : m.type === "wall"
                ? geomLenFeet(geometry, currentScale.x, currentScale.y) *
                  (m.wall_height ?? 0) *
                  (m.wall_sided === "double" ? 2 : 1)
                : m.type === "volume"
                  ? m.vol_mode === "area"
                    ? polyAreaSqFt(geometry, currentScale.x, currentScale.y) *
                      (m.vol_depth ?? 0)
                    : geomLenFeet(geometry, currentScale.x, currentScale.y) *
                      (m.vol_width ?? 0) *
                      (m.vol_depth ?? 0)
                  : geomLenFeet(geometry, currentScale.x, currentScale.y);
        }
        setMeasurements((arr) =>
          arr.map((x) => (x.id === id ? { ...x, geometry, value } : x)),
        );
        await supabase.from("measurements").update({ geometry, value }).eq("id", id);
      }
    }
  }

  // ---- edit / copy / delete ----
  async function updateSelected(patch: Partial<Pick<Measurement, "layer" | "color">>) {
    if (!selected) return;
    setMeasurements((arr) =>
      arr.map((x) => (x.id === selected.id ? { ...x, ...patch } : x)),
    );
    await supabase.from("measurements").update(patch).eq("id", selected.id);
  }

  // Height / sides change recomputes the wall's area.
  async function updateWall(patch: {
    wall_sided?: "single" | "double";
    wall_height?: number;
  }) {
    if (!selected || selected.type !== "wall") return;
    const height = patch.wall_height ?? selected.wall_height ?? 0;
    const sided = patch.wall_sided ?? selected.wall_sided;
    const value =
      currentScale?.x && currentScale?.y
        ? geomLenFeet(selected.geometry, currentScale.x, currentScale.y) *
          height *
          (sided === "double" ? 2 : 1)
        : selected.value;
    setMeasurements((arr) =>
      arr.map((x) => (x.id === selected.id ? { ...x, ...patch, value } : x)),
    );
    await supabase
      .from("measurements")
      .update({ ...patch, value })
      .eq("id", selected.id);
  }

  // Width / depth change recomputes the volume (cubic feet).
  async function updateVolume(patch: { vol_width?: number; vol_depth?: number }) {
    if (!selected || selected.type !== "volume") return;
    const depth = patch.vol_depth ?? selected.vol_depth ?? 0;
    const width = patch.vol_width ?? selected.vol_width ?? 0;
    let value = selected.value;
    if (currentScale?.x && currentScale?.y) {
      value =
        selected.vol_mode === "area"
          ? polyAreaSqFt(selected.geometry, currentScale.x, currentScale.y) * depth
          : geomLenFeet(selected.geometry, currentScale.x, currentScale.y) *
            width *
            depth;
    }
    setMeasurements((arr) =>
      arr.map((x) => (x.id === selected.id ? { ...x, ...patch, value } : x)),
    );
    await supabase
      .from("measurements")
      .update({ ...patch, value })
      .eq("id", selected.id);
  }

  // Leader text + sizes (each leader independent; sizes are in PDF points).
  async function updateLeader(
    patch: Partial<Pick<Measurement, "text" | "font_size" | "head_size">>,
  ) {
    if (!selected || selected.type !== "leader") return;
    setMeasurements((arr) =>
      arr.map((x) => (x.id === selected.id ? { ...x, ...patch } : x)),
    );
    await supabase.from("measurements").update(patch).eq("id", selected.id);
  }

  async function duplicateMeasurement(m: Measurement) {
    if (!currentSheet) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const off = 12 / scale;
    const geometry = m.geometry.map((p) => ({ x: p.x + off, y: p.y + off }));
    const { data } = await supabase
      .from("measurements")
      .insert({
        project_id: projectId,
        plan_file_id: planFile.id,
        sheet_id: currentSheet.id,
        owner_id: user.id,
        type: m.type,
        geometry,
        value: m.value,
        unit: m.unit,
        layer: m.layer,
        color: m.color,
        wall_sided: m.wall_sided,
        wall_height: m.wall_height,
        vol_mode: m.vol_mode,
        vol_width: m.vol_width,
        vol_depth: m.vol_depth,
      })
      .select(MEAS_COLS)
      .single();
    if (data) {
      setMeasurements((arr) => [...arr, data as Measurement]);
      setSelectedId((data as Measurement).id);
    }
  }
  function duplicateSelected() {
    if (selected) duplicateMeasurement(selected);
  }

  // ── Layer-level edits: one change applies to every run in the layer ──────
  async function renameLayer(rows: Measurement[], newName: string) {
    const ids = rows.map((r) => r.id);
    const layerVal = newName.trim() || null;
    setMeasurements((arr) =>
      arr.map((m) => (ids.includes(m.id) ? { ...m, layer: layerVal } : m)),
    );
    await supabase.from("measurements").update({ layer: layerVal }).in("id", ids);
  }

  async function recolorLayer(rows: Measurement[], newColor: string) {
    const ids = rows.map((r) => r.id);
    setMeasurements((arr) =>
      arr.map((m) => (ids.includes(m.id) ? { ...m, color: newColor } : m)),
    );
    await supabase.from("measurements").update({ color: newColor }).in("id", ids);
  }

  // Change wall height/sides or volume width/depth for the WHOLE layer; every
  // affected run's value is recomputed automatically (single↔double doubles
  // the area, new height re-derives every run, etc.).
  async function updateLayerAttrs(
    rows: Measurement[],
    patch: Partial<
      Pick<Measurement, "wall_height" | "wall_sided" | "vol_width" | "vol_depth">
    >,
  ) {
    const sx = currentScale?.x;
    const sy = currentScale?.y;
    if (sx == null || sy == null) return;
    const wallPatch = "wall_height" in patch || "wall_sided" in patch;
    const volPatch = "vol_width" in patch || "vol_depth" in patch;
    const updated = rows
      .filter(
        (m) =>
          (m.type === "wall" && wallPatch) || (m.type === "volume" && volPatch),
      )
      .map((m) => {
        const next = { ...m, ...patch } as Measurement;
        next.value = recomputeValue(next, sx, sy);
        return next;
      });
    if (!updated.length) return;
    const byId = new Map(updated.map((m) => [m.id, m]));
    setMeasurements((arr) => arr.map((m) => byId.get(m.id) ?? m));
    for (let i = 0; i < updated.length; i += 10) {
      await Promise.all(
        updated.slice(i, i + 10).map((m) =>
          supabase
            .from("measurements")
            .update({
              wall_height: m.wall_height,
              wall_sided: m.wall_sided,
              vol_width: m.vol_width,
              vol_depth: m.vol_depth,
              value: m.value,
            })
            .eq("id", m.id),
        ),
      );
    }
  }

  async function deleteLayer(rows: Measurement[]) {
    const label = layerKeyOf(rows[0]?.layer ?? null);
    if (
      !window.confirm(
        `Delete layer "${label}" and its ${rows.length} measurement${rows.length > 1 ? "s" : ""}? This can't be undone.`,
      )
    )
      return;
    const ids = rows.map((r) => r.id);
    setMeasurements((arr) => arr.filter((m) => !ids.includes(m.id)));
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    setEditingLayer(null);
    await supabase.from("measurements").delete().in("id", ids);
  }

  function openLayerEditor(g: { layer: string; rows: Measurement[] }) {
    if (editingLayer === g.layer) {
      setEditingLayer(null);
      return;
    }
    setEditingLayer(g.layer);
    setLayerName(g.layer === "Unlabeled" ? "" : g.layer);
    const w = g.rows.find((r) => r.type === "wall");
    setLayerHeight(w ? String(w.wall_height ?? 8) : "");
    setLayerSided(w?.wall_sided === "double" ? "double" : "single");
    const v = g.rows.find((r) => r.type === "volume");
    setLayerVolW(v && v.vol_width != null ? String(v.vol_width) : "");
    setLayerVolD(v && v.vol_depth != null ? String(v.vol_depth) : "");
  }

  async function deleteMeasurement(id: string) {
    await supabase.from("measurements").delete().eq("id", id);
    setMeasurements((m) => m.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // ---- pan ----
  function onPanDown(e: React.PointerEvent) {
    const vp = viewportRef.current;
    if (!vp) return;
    if (e.button === 2) panMovedRef.current = false; // track right-drag vs right-click
    if (
      e.button === 1 || // middle
      e.button === 2 || // right (default pan)
      (e.button === 0 && (tool === "browse" || spaceHeld))
    ) {
      panRef.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      vp.setPointerCapture(e.pointerId);
    }
  }
  function onPanMove(e: React.PointerEvent) {
    const vp = viewportRef.current;
    if (!vp || !panRef.current) return;
    if (
      Math.abs(e.clientX - panRef.current.x) > 4 ||
      Math.abs(e.clientY - panRef.current.y) > 4
    ) {
      panMovedRef.current = true;
    }
    vp.scrollLeft = panRef.current.sl - (e.clientX - panRef.current.x);
    vp.scrollTop = panRef.current.st - (e.clientY - panRef.current.y);
  }
  function onPanEnd(e: React.PointerEvent) {
    const vp = viewportRef.current;
    if (panRef.current && vp) {
      try {
        vp.releasePointerCapture(e.pointerId);
      } catch {}
    }
    panRef.current = null;
  }

  // Right-click on the canvas: show a context menu unless it was a right-drag pan.
  function onCanvasContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (panMovedRef.current) {
      panMovedRef.current = false;
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
    const id = pickMeasurementAt(pt);
    if (id) {
      setSelectedId(id);
      setMenu({ x: e.clientX, y: e.clientY, kind: "measurement", id });
    } else {
      setMenu({ x: e.clientX, y: e.clientY, kind: "canvas" });
    }
  }

  async function deleteSheet(id: string, pageNumber: number) {
    if (
      !window.confirm(
        "Delete this sheet and all its measurements? This can't be undone.",
      )
    )
      return;
    setMenu(null);
    await supabase.from("measurements").delete().eq("sheet_id", id);
    await supabase.from("sheets").delete().eq("id", id);
    if (pageNum === pageNumber) setPageNum(1);
    router.refresh();
  }

  // ── On-sheet takeoff legend (ledger) ──────────────────────────────────────
  function updateLedger(patch: Partial<Ledger>) {
    if (!currentSheet) return;
    const id = currentSheet.id;
    setLedgers((prev) => {
      const next = { ...(prev[id] ?? DEFAULT_LEDGER), ...patch };
      if (ledgerSaveTimer.current) clearTimeout(ledgerSaveTimer.current);
      ledgerSaveTimer.current = setTimeout(() => {
        supabase.from("sheets").update({ ledger: next }).eq("id", id);
      }, 400);
      return { ...prev, [id]: next };
    });
  }

  function startLedgerDrag(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    const led = currentLedger;
    if (!canvas || !led) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = led.x;
    const oy = led.y;
    const onMove = (ev: PointerEvent) => {
      updateLedger({
        x: Math.max(0, Math.min(0.98, ox + (ev.clientX - sx) / rect.width)),
        y: Math.max(0, Math.min(0.98, oy + (ev.clientY - sy) / rect.height)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startLedgerResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const led = currentLedger;
    if (!led) return;
    const sx = e.clientX;
    const base = led.scale;
    const onMove = (ev: PointerEvent) => {
      // ~150px of drag ≈ one full step of the size multiplier.
      updateLedger({ scale: Math.max(0.4, Math.min(5, base + (ev.clientX - sx) / 150)) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── Export marked-up PDF ──────────────────────────────────────────────────
  async function openExport() {
    const { data } = await supabase
      .from("measurements")
      .select("sheet_id")
      .eq("plan_file_id", planFile.id);
    const marked = new Set<string>(
      (data ?? []).map((r) => (r as { sheet_id: string }).sheet_id),
    );
    setMarkedSheets(marked);
    setExportSel(new Set(marked.size ? [...marked] : sheets.map((s) => s.id)));
    setExportOpen(true);
  }

  async function exportMarkedPdf() {
    const pdf = pdfRef.current;
    if (!pdf || !exportSel.size) return;
    setExporting("Preparing…");
    try {
      const { data } = await supabase
        .from("measurements")
        .select(`${MEAS_COLS},sheet_id`)
        .in("sheet_id", [...exportSel]);
      const bySheet = new Map<string, Measurement[]>();
      for (const m of (data ?? []) as (Measurement & { sheet_id: string })[]) {
        const arr = bySheet.get(m.sheet_id) ?? [];
        arr.push(m);
        bySheet.set(m.sheet_id, arr);
      }
      const { PDFDocument } = await import("pdf-lib");
      const out = await PDFDocument.create();
      const K = 2; // render at 2× for crisp lines and text
      const chosen = sheets
        .filter((s) => exportSel.has(s.id))
        .sort((a, b) => a.page_number - b.page_number);
      let done = 0;
      for (const s of chosen) {
        setExporting(`Rendering ${++done} / ${chosen.length}…`);
        const page = await pdf.getPage(s.page_number);
        const viewport = page.getViewport({ scale: K });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const ms = bySheet.get(s.id) ?? [];
        drawMarkupOnCanvas(ctx, ms, K);
        // Either force the legend onto every page, or honor each sheet's toggle.
        const led = exportLegend
          ? { ...(ledgers[s.id] ?? DEFAULT_LEDGER), visible: true }
          : ledgers[s.id];
        drawLedgerOnCanvas(ctx, ms, K, led, canvas.width, canvas.height);
        const png = await out.embedPng(canvas.toDataURL("image/png"));
        const pg = out.addPage([canvas.width, canvas.height]);
        pg.drawImage(png, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      }
      setExporting("Saving…");
      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const base =
        (planFile as { file_name?: string | null }).file_name?.replace(
          /\.[^.]+$/,
          "",
        ) || "takeoff";
      a.href = url;
      a.download = `${base}-markup.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch {
      setError("Export failed — try fewer sheets, or reload and retry.");
    } finally {
      setExporting(null);
    }
  }

  function px(p: Pt) {
    return { x: p.x * scale, y: p.y * scale };
  }

  // On-screen size of the page at the current zoom. The canvas bitmap may be
  // rasterized at a different scale (rasterScale); the browser scales it to fit.
  const displayW = baseDims.w * scale;
  const displayH = baseDims.h * scale;

  // Lay out the on-drawing labels, nudging each one down until it no longer
  // overlaps an already-placed label (greedy collision avoidance).
  const LABEL_FONT = 14;
  const labelLayout: Record<string, { x: number; y: number; text: string }> = {};
  {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const lineH = LABEL_FONT + 4;
    for (const m of measurements) {
      const text = labelText(m);
      if (!text) continue;
      const geom = m.id === selectedId && editGeom ? editGeom : m.geometry;
      if (geom.length === 0) continue;
      const centered =
        m.type === "area" ||
        m.type === "count" ||
        (m.type === "volume" && m.vol_mode === "area");
      const anchor = centered
        ? {
            x: geom.reduce((s, p) => s + p.x, 0) / geom.length,
            y: geom.reduce((s, p) => s + p.y, 0) / geom.length,
          }
        : geom.length >= 2
          ? { x: (geom[0].x + geom[1].x) / 2, y: (geom[0].y + geom[1].y) / 2 }
          : geom[0];
      const base = px(anchor);
      const x = base.x + 6;
      let y = base.y - 6;
      const w = text.length * LABEL_FONT * 0.6 + 6;
      let tries = 0;
      while (
        tries < 40 &&
        placed.some(
          (r) => x < r.x + r.w && x + w > r.x && y - lineH < r.y && y > r.y - lineH,
        )
      ) {
        y += lineH;
        tries++;
      }
      placed.push({ x, y, w, h: lineH });
      labelLayout[m.id] = { x, y, text };
    }
  }

  const TOOLS: { id: Tool; label: string }[] = [
    { id: "select", label: "Select" },
    { id: "browse", label: "Pan" },
    { id: "calibrate", label: "Calibrate" },
    { id: "line", label: "Line" },
    { id: "polyline", label: "Polyline" },
    { id: "area", label: "Area" },
    { id: "wall", label: "Wall" },
    { id: "volume", label: "Volume" },
    { id: "count", label: "Count" },
    { id: "leader", label: "Leader" },
  ];

  // Running totals for this sheet, grouped by layer and summed per unit.
  // One group per layer: rows + summed totals. The panel shows these groups
  // (Bluebeam-style) instead of a flat record list — the group IS the takeoff
  // line; its rows are the individual runs you drew.
  const layerGroups = buildLayerGroups(measurements);

  // The legend lists only layers with measured quantities (skips leader-only/
  // empty groups). Each row: color, layer name, summed total(s), run count.
  const ledgerRows = layerGroups.filter((g) => g.lines.length > 0);

  // Items for the right-click menu, by what was clicked.
  const menuItems: { label: string; danger?: boolean; onClick: () => void }[] =
    !menu
      ? []
      : menu.kind === "measurement"
        ? (() => {
            const m = measurements.find((x) => x.id === menu.id);
            return m
              ? [
                  {
                    label: "Edit",
                    onClick: () => {
                      setTool("select");
                      setSelectedId(m.id);
                    },
                  },
                  { label: "Duplicate", onClick: () => duplicateMeasurement(m) },
                  {
                    label: "Delete",
                    danger: true,
                    onClick: () => deleteMeasurement(m.id),
                  },
                ]
              : [];
          })()
        : menu.kind === "sheet"
          ? (() => {
              const s = sheets.find((x) => x.id === menu.id);
              return s
                ? [
                    { label: "Open", onClick: () => setPageNum(s.page_number) },
                    {
                      label: "Rename",
                      onClick: () => setEditingSheetId(s.id),
                    },
                    {
                      label: "Delete sheet",
                      danger: true,
                      onClick: () => deleteSheet(s.id, s.page_number),
                    },
                  ]
                : [];
            })()
          : TOOLS.filter((t) => t.id !== "browse").map((t) => ({
              label: t.label,
              onClick: () => selectTool(t.id),
            }));

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Sheet navigator (collapsible + resizable) */}
      {navOpen ? (
        <>
          <aside
            className="glass z-10 flex shrink-0 flex-col"
            style={{ width: navW }}
          >
            <div className="flex items-start justify-between gap-2 border-b border-white/10 px-3 py-3">
              <div className="min-w-0">
                <Link
                  href={`/projects/${projectId}`}
                  className="text-xs text-muted transition-colors hover:text-brand-soft"
                >
                  ← Back to project
                </Link>
                <p
                  className="mt-1 truncate text-sm text-foreground"
                  title={planFile.file_name}
                >
                  {planFile.file_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                title="Hide sheets"
                className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-muted transition-colors hover:border-brand hover:text-foreground"
              >
                «
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sheets.map((s) => {
                const active = s.page_number === pageNum;
                const editing = editingSheetId === s.id;
                return (
                  <div
                    key={s.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        kind: "sheet",
                        id: s.id,
                      });
                    }}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? "glass-brand text-foreground"
                        : "text-muted hover:bg-white/5 hover:text-foreground"
                    }`}
                  >
                    {editing ? (
                      <input
                        autoFocus
                        defaultValue={sheetNames[s.id] ?? ""}
                        placeholder={`Sheet ${s.page_number}`}
                        onBlur={(e) => {
                          saveSheetName(s.id, e.target.value);
                          setEditingSheetId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            saveSheetName(
                              s.id,
                              (e.target as HTMLInputElement).value,
                            );
                            setEditingSheetId(null);
                          } else if (e.key === "Escape") {
                            setEditingSheetId(null);
                          }
                        }}
                        className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-sm text-foreground focus:border-brand focus:outline-none"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setPageNum(s.page_number)}
                          onDoubleClick={() => setEditingSheetId(s.id)}
                          title="Click to open · double-click to rename"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="truncate">{sheetTitle(s)}</span>
                          {s.label ? (
                            <span className="shrink-0 rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-muted">
                              {s.label}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSheetId(s.id)}
                          title="Rename"
                          className="shrink-0 rounded px-1 text-xs text-muted opacity-0 transition hover:text-brand-soft group-hover:opacity-100"
                        >
                          ✎
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
          <div
            className="resize-handle z-10"
            onPointerDown={(e) => startResize("left", e)}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          title="Show sheets"
          className="glass-strong absolute left-2 top-2 z-20 rounded-md px-2.5 py-1 text-sm text-foreground"
        >
          » Sheets
        </button>
      )}

      {/* Center */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="glass-strong z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <button
              type="button"
              onClick={() => setPageNum((p) => Math.max(1, p - 1))}
              disabled={pageNum <= 1}
              className="rounded-md border border-border px-2 py-1 text-foreground hover:border-brand disabled:opacity-40"
            >
              ‹
            </button>
            <span>
              {pageNum} / {numPages || "…"}
            </span>
            <button
              type="button"
              onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
              disabled={pageNum >= numPages}
              className="rounded-md border border-border px-2 py-1 text-foreground hover:border-brand disabled:opacity-40"
            >
              ›
            </button>
          </div>

          <div className="flex items-center gap-1">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTool(t.id)}
                className={`rounded-md border px-3 py-1 transition-colors ${
                  tool === t.id
                    ? "border-brand bg-brand/15 text-foreground"
                    : "border-border text-muted hover:border-brand"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-muted">
            <label className="flex items-center gap-1.5">
              <span className="text-xs uppercase tracking-wider">Scale</span>
              <select
                value={currentScale?.preset ?? ""}
                onChange={(e) => applyPreset(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-foreground focus:border-brand focus:outline-none"
              >
                <option value="">
                  {hasScale && !currentScale?.preset ? "Manual" : "Not set"}
                </option>
                <optgroup label="Architectural">
                  {PRESETS.filter((p) => p.group === "Architectural").map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Civil / Engineering">
                  {PRESETS.filter((p) => p.group === "Civil").map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setScale((s) => Math.max(0.1, s / 1.25))}
                className="rounded-md border border-border px-2 py-1 text-foreground hover:border-brand"
              >
                −
              </button>
              <span className="w-12 text-center">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                onClick={() => setScale((s) => Math.min(6, s * 1.25))}
                className="rounded-md border border-border px-2 py-1 text-foreground hover:border-brand"
              >
                +
              </button>
              <button
                type="button"
                onClick={fitWidth}
                className="rounded-md border border-border px-3 py-1 text-foreground hover:border-brand"
              >
                Fit
              </button>
            </div>
            {ledgerRows.length ? (
              <button
                type="button"
                onClick={() => updateLedger({ visible: !currentLedger?.visible })}
                className={`rounded-md border px-3 py-1 transition-colors ${
                  currentLedger?.visible
                    ? "border-brand bg-brand/15 text-foreground"
                    : "border-border text-muted hover:border-brand"
                }`}
              >
                {currentLedger?.visible ? "Hide legend" : "Show legend"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={openExport}
              disabled={status !== "ready"}
              className="rounded-md border border-border px-3 py-1 text-foreground hover:border-brand disabled:opacity-40"
            >
              Export PDF
            </button>
          </div>
        </div>

        {/* New-measurement attributes (Line / Polyline / Area / Wall / Volume / Count) */}
        {tool === "line" ||
        tool === "polyline" ||
        tool === "area" ||
        tool === "wall" ||
        tool === "volume" ||
        tool === "count" ? (
          <div className="glass z-10 flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="text-xs uppercase tracking-wider text-muted">Layer</span>
            <input
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
              placeholder="e.g. Exterior wall"
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
            />
            <span className="text-xs uppercase tracking-wider text-muted">Color</span>
            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  className={`h-5 w-5 rounded-full ${color === c ? "ring-2 ring-foreground" : ""}`}
                />
              ))}
            </div>
            {tool === "wall" ? (
              <>
                <span className="text-xs uppercase tracking-wider text-muted">Height</span>
                <div className="flex items-center gap-1">
                  <input
                    value={wallHeight}
                    onChange={(e) => setWallHeight(e.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-foreground focus:border-brand focus:outline-none"
                  />
                  <span className="text-xs text-muted">ft</span>
                </div>
                <div className="flex items-center gap-1">
                  {(["single", "double"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setWallSided(s)}
                      className={`rounded-md border px-2 py-1 text-xs capitalize transition-colors ${
                        wallSided === s
                          ? "border-brand bg-brand/15 text-foreground"
                          : "border-border text-muted hover:border-brand"
                      }`}
                    >
                      {s}-sided
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {tool === "volume" ? (
              <>
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["linear", "Linear run"],
                      ["area", "Area × depth"],
                    ] as const
                  ).map(([m, lbl]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setVolMode(m);
                        setDraft([]);
                        setHover(null);
                      }}
                      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                        volMode === m
                          ? "border-brand bg-brand/15 text-foreground"
                          : "border-border text-muted hover:border-brand"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {volMode === "linear" ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs uppercase tracking-wider text-muted">
                      Width
                    </span>
                    <input
                      value={volWidth}
                      onChange={(e) => setVolWidth(e.target.value)}
                      inputMode="decimal"
                      className="w-16 rounded-md border border-border bg-background px-2 py-1 text-foreground focus:border-brand focus:outline-none"
                    />
                    <span className="text-xs text-muted">ft</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-1">
                  <span className="text-xs uppercase tracking-wider text-muted">
                    Depth
                  </span>
                  <input
                    value={volDepth}
                    onChange={(e) => setVolDepth(e.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-foreground focus:border-brand focus:outline-none"
                  />
                  <span className="text-xs text-muted">ft</span>
                </div>
              </>
            ) : null}
            {tool === "count" ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">
                  {activeCountId
                    ? `Counting: ${
                        measurements.find((m) => m.id === activeCountId)?.value ?? 0
                      } (auto-saved)`
                    : "Click each item — every click saves"}
                </span>
                <button
                  type="button"
                  onClick={finishCount}
                  disabled={!activeCountId}
                  className="rounded-md bg-brand px-3 py-1 font-medium text-white hover:bg-brand-strong disabled:opacity-40"
                >
                  Finish count
                </button>
              </div>
            ) : null}
            {!hasScale && tool !== "count" ? (
              <span className="text-xs text-brand-soft">Set a scale before measuring.</span>
            ) : null}
          </div>
        ) : null}

        {/* Calibration prompt */}
        {calib ? (
          <div className="glass-brand z-10 flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="text-foreground">Length of the line you drew:</span>
            <input
              autoFocus
              value={calibFeet}
              onChange={(e) => setCalibFeet(e.target.value)}
              placeholder="feet"
              inputMode="decimal"
              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-foreground focus:border-brand focus:outline-none"
            />
            <label className="flex items-center gap-1 text-muted">
              <input type="radio" checked={calibAxis === "h"} onChange={() => setCalibAxis("h")} />
              Horizontal
            </label>
            <label className="flex items-center gap-1 text-muted">
              <input type="radio" checked={calibAxis === "v"} onChange={() => setCalibAxis("v")} />
              Vertical
            </label>
            <button
              type="button"
              onClick={applyCalibration}
              className="rounded-md bg-brand px-3 py-1 font-medium text-white hover:bg-brand-strong"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setCalib(null)}
              className="rounded-md border border-border px-3 py-1 text-foreground hover:border-brand"
            >
              Cancel
            </button>
          </div>
        ) : null}

        {/* Canvas + overlay */}
        <div
          ref={viewportRef}
          onPointerDown={onPanDown}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerLeave={onPanEnd}
          onContextMenu={onCanvasContextMenu}
          className="relative min-h-0 flex-1 overflow-auto bg-black/40"
          style={{ cursor: spaceHeld || tool === "browse" ? "grab" : "default" }}
        >
          {status === "error" ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-brand-soft">
              {error}
            </p>
          ) : status === "loading" ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
              Loading plan…
            </p>
          ) : (
            <div
              className="w-max"
              style={{
                padding: `${Math.max(vpSize.h, 24)}px ${Math.max(vpSize.w, 24)}px`,
              }}
            >
              <div className="relative h-fit">
                <canvas
                  ref={canvasRef}
                  className="block rounded shadow-lg"
                  style={{
                    width: displayW || undefined,
                    height: displayH || undefined,
                  }}
                />
                <svg
                  ref={svgRef}
                  width={displayW}
                  height={displayH}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onDoubleClick={onDoubleClick}
                  className="absolute left-0 top-0"
                  style={{
                    pointerEvents: tool === "browse" ? "none" : "auto",
                    cursor: spaceHeld
                      ? "grab"
                      : tool === "select"
                        ? "pointer"
                        : tool === "browse"
                          ? "default"
                          : "crosshair",
                  }}
                >
                  {measurements
                    .filter((m) => !hiddenLayers.has(layerKeyOf(m.layer)))
                    .map((m) => {
                    const geom =
                      m.id === selectedId && editGeom ? editGeom : m.geometry;
                    const pts = geom.map(px);
                    const isSel = m.id === selectedId;
                    const isCount = m.type === "count";
                    const isFilled =
                      m.type === "area" ||
                      (m.type === "volume" && m.vol_mode === "area");
                    const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                    const lbl = labelLayout[m.id];
                    return (
                      <g key={m.id}>
                        {isSel && !isCount ? (
                          isFilled ? (
                            <polygon
                              points={ptsStr}
                              fill="none"
                              stroke="#fff"
                              strokeWidth={5}
                              opacity={0.5}
                            />
                          ) : (
                            <polyline
                              points={ptsStr}
                              fill="none"
                              stroke="#fff"
                              strokeWidth={5}
                              opacity={0.5}
                            />
                          )
                        ) : null}
                        {isCount ? (
                          geom.map((p, i) => {
                            const c = px(p);
                            return (
                              <circle
                                key={`mk-${i}`}
                                cx={c.x}
                                cy={c.y}
                                r={6}
                                fill={m.color ?? "#A01C2D"}
                                fillOpacity={0.85}
                                stroke="#fff"
                                strokeWidth={1.5}
                              />
                            );
                          })
                        ) : isFilled ? (
                          <polygon
                            points={ptsStr}
                            fill={m.color ?? "#A01C2D"}
                            fillOpacity={0.15}
                            stroke={m.color ?? "#A01C2D"}
                            strokeWidth={2}
                          />
                        ) : (
                          <polyline
                            points={ptsStr}
                            fill="none"
                            stroke={m.color ?? "#A01C2D"}
                            strokeWidth={2}
                          />
                        )}
                        {m.type === "leader" && pts.length >= 2
                          ? (() => {
                              const head = pts[0];
                              const box = pts[1];
                              const ang = Math.atan2(
                                head.y - box.y,
                                head.x - box.x,
                              );
                              const hs =
                                (m.head_size ?? LEADER_HEAD_DEFAULT) * scale;
                              const a1 = {
                                x: head.x - hs * Math.cos(ang - 0.42),
                                y: head.y - hs * Math.sin(ang - 0.42),
                              };
                              const a2 = {
                                x: head.x - hs * Math.cos(ang + 0.42),
                                y: head.y - hs * Math.sin(ang + 0.42),
                              };
                              const fs =
                                (m.font_size ?? LEADER_FONT_DEFAULT) * scale;
                              const lines = (m.text ?? "").split("\n");
                              return (
                                <>
                                  <polygon
                                    points={`${head.x},${head.y} ${a1.x},${a1.y} ${a2.x},${a2.y}`}
                                    fill={m.color ?? "#A01C2D"}
                                  />
                                  {lines.some((l) => l.trim()) ? (
                                    <text
                                      x={box.x + 5}
                                      y={box.y}
                                      fontSize={fs}
                                      fontWeight={600}
                                      fill={m.color ?? "#A01C2D"}
                                      stroke="#fff"
                                      strokeWidth={Math.max(2, fs * 0.16)}
                                      style={{
                                        paintOrder: "stroke",
                                        pointerEvents: "none",
                                      }}
                                    >
                                      {lines.map((ln, i) => (
                                        <tspan
                                          key={i}
                                          x={box.x + 5}
                                          dy={i === 0 ? 0 : fs * 1.15}
                                        >
                                          {ln || " "}
                                        </tspan>
                                      ))}
                                    </text>
                                  ) : null}
                                </>
                              );
                            })()
                          : null}
                        {lbl ? (
                          <text
                            x={lbl.x}
                            y={lbl.y}
                            fontSize={LABEL_FONT}
                            fontWeight={700}
                            fill="#fff"
                            stroke="#000"
                            strokeWidth={3.5}
                            style={{ paintOrder: "stroke", pointerEvents: "none" }}
                          >
                            {lbl.text}
                          </text>
                        ) : null}
                        {isSel && tool === "select"
                          ? pts.map((p, i) => (
                              <circle
                                key={i}
                                cx={p.x}
                                cy={p.y}
                                r={5}
                                fill="#fff"
                                stroke={m.color ?? "#A01C2D"}
                                strokeWidth={2}
                                style={{ cursor: "grab" }}
                              />
                            ))
                          : null}
                      </g>
                    );
                  })}
                  {draft.length >= 1 ? (
                    <g>
                      {(tool === "area" ||
                        (tool === "volume" && volMode === "area")) &&
                      draft.length >= 2 ? (
                        <polygon
                          points={[...draft, ...(hover ? [hover] : [])]
                            .map((p) => `${px(p).x},${px(p).y}`)
                            .join(" ")}
                          fill={color}
                          fillOpacity={0.15}
                          stroke="none"
                        />
                      ) : null}
                      {draft.length >= 2 ? (
                        <polyline
                          points={draft.map((p) => `${px(p).x},${px(p).y}`).join(" ")}
                          fill="none"
                          stroke={tool === "calibrate" ? "#22d3ee" : color}
                          strokeWidth={2}
                        />
                      ) : null}
                      {hover ? (
                        <line
                          x1={px(draft[draft.length - 1]).x}
                          y1={px(draft[draft.length - 1]).y}
                          x2={px(hover).x}
                          y2={px(hover).y}
                          stroke={tool === "calibrate" ? "#22d3ee" : color}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                        />
                      ) : null}
                      {(tool === "area" ||
                        (tool === "volume" && volMode === "area")) &&
                      hover &&
                      draft.length >= 2 ? (
                        <line
                          x1={px(hover).x}
                          y1={px(hover).y}
                          x2={px(draft[0]).x}
                          y2={px(draft[0]).y}
                          stroke={color}
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          opacity={0.6}
                        />
                      ) : null}
                      {draft.map((p, i) => (
                        <circle
                          key={i}
                          cx={px(p).x}
                          cy={px(p).y}
                          r={3}
                          fill={tool === "calibrate" ? "#22d3ee" : color}
                        />
                      ))}
                      {tool !== "calibrate" &&
                      hover &&
                      currentScale?.x &&
                      currentScale?.y ? (
                        <text
                          x={px(hover).x + 6}
                          y={px(hover).y - 6}
                          fontSize={LABEL_FONT}
                          fontWeight={700}
                          fill="#fff"
                          stroke="#000"
                          strokeWidth={3.5}
                          style={{ paintOrder: "stroke", pointerEvents: "none" }}
                        >
                          {tool === "area"
                            ? `${polyAreaSqFt(
                                [...draft, hover],
                                currentScale.x,
                                currentScale.y,
                              ).toFixed(0)} sf`
                            : tool === "wall"
                              ? `${(
                                  geomLenFeet(
                                    [...draft, hover],
                                    currentScale.x,
                                    currentScale.y,
                                  ) *
                                  (parseFloat(wallHeight) || 0) *
                                  (wallSided === "double" ? 2 : 1)
                                ).toFixed(0)} sf`
                              : tool === "volume"
                                ? `${(
                                    (volMode === "area"
                                      ? polyAreaSqFt(
                                          [...draft, hover],
                                          currentScale.x,
                                          currentScale.y,
                                        )
                                      : geomLenFeet(
                                          [...draft, hover],
                                          currentScale.x,
                                          currentScale.y,
                                        ) * (parseFloat(volWidth) || 0)) *
                                    (parseFloat(volDepth) || 0)
                                  ).toFixed(0)} cf`
                                : `${geomLenFeet(
                                    [...draft, hover],
                                    currentScale.x,
                                    currentScale.y,
                                  ).toFixed(1)} ft`}
                        </text>
                      ) : null}
                    </g>
                  ) : null}
                  {calib ? (
                    <line
                      x1={px(calib.p1).x}
                      y1={px(calib.p1).y}
                      x2={px(calib.p2).x}
                      y2={px(calib.p2).y}
                      stroke="#22d3ee"
                      strokeWidth={2}
                    />
                  ) : null}
                </svg>
                {currentLedger?.visible && ledgerRows.length ? (
                  <div
                    className="absolute z-20 select-none"
                    style={{
                      left: currentLedger.x * displayW,
                      top: currentLedger.y * displayH,
                      transform: `scale(${scale * currentLedger.scale})`,
                      transformOrigin: "top left",
                      width: LEDGER_BASE_W,
                      fontSize: LEDGER_BASE_FONT,
                    }}
                  >
                    <div className="relative rounded border border-neutral-400 bg-white/95 text-black shadow-lg">
                      <div
                        onPointerDown={startLedgerDrag}
                        className="flex cursor-move items-center justify-between border-b border-neutral-300 bg-neutral-100 px-2 py-1 font-semibold"
                      >
                        <span>Takeoff Legend</span>
                      </div>
                      <div className="divide-y divide-neutral-200">
                        {ledgerRows.map((g) => (
                          <div
                            key={g.layer}
                            className="flex items-start gap-1.5 px-2 py-1"
                          >
                            <span
                              className="mt-[2px] inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ background: g.color }}
                            />
                            <span className="flex-1 leading-tight">
                              <span className="font-medium">{g.layer}</span>
                              <span className="text-neutral-600">
                                {" "}
                                — {g.lines.join(", ")} · {g.rows.length} run
                                {g.rows.length === 1 ? "" : "s"}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                      <div
                        onPointerDown={startLedgerResize}
                        title="Drag to resize"
                        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
                        style={{
                          background:
                            "linear-gradient(135deg, transparent 45%, #888 45%, #888 55%, transparent 55%, transparent 70%, #888 70%, #888 80%, transparent 80%)",
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
          {status === "ready" ? (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[11px] text-muted">
              {tool === "count"
                ? "Click each item (auto-saved) · click a marker again to remove it · Finish when done · "
                : tool === "polyline" ||
                    tool === "wall" ||
                    (tool === "volume" && volMode === "linear")
                  ? "Click to add points · double-click to finish · "
                  : tool === "area" || (tool === "volume" && volMode === "area")
                    ? "Click corners · click the first point or double-click to close · "
                    : tool === "leader"
                      ? "Click where the arrow points, then click to place the text box · "
                      : ""}
              Esc: cancel · Right-drag / Space / middle-drag: pan · Del: delete
            </div>
          ) : null}
        </div>

        {/* Floating glassy notes (collapses to a chip to save space) */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 w-[min(720px,92%)] -translate-x-1/2">
          {notesOpen ? (
            <div className="glass-strong pointer-events-auto rounded-2xl p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="sheet-notes"
                  className="text-xs uppercase tracking-wider text-muted"
                >
                  Notes for the AI — about this sheet
                </label>
                <div className="flex items-center gap-2">
                  {notesSaved ? (
                    <span className="text-xs text-brand-soft">Saved</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setNotesOpen(false)}
                    title="Hide notes"
                    className="rounded px-1 text-muted transition-colors hover:text-foreground"
                  >
                    ▾
                  </button>
                </div>
              </div>
              <textarea
                id="sheet-notes"
                value={currentSheet ? notes[currentSheet.id] ?? "" : ""}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={(e) => saveNotes(e.currentTarget.value)}
                rows={5}
                placeholder={
                  "Tell the AI anything it should know about this sheet, e.g.\n" +
                  "• Unit A dimensions are on this sheet\n" +
                  "• Exterior walls are 8\" CMU, interior are 2x4 wood\n" +
                  "• Door & window schedule is on sheet A-6\n" +
                  "• Exclude the canopy — owner-furnished"
                }
                className="max-h-[40vh] min-h-[7rem] w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted/50 focus:border-brand focus:outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              title="Sheet notes for the AI"
              className="glass-strong pointer-events-auto mx-auto flex items-center gap-2 rounded-full px-6 py-3 text-base font-medium text-foreground"
            >
              <span className="text-xl leading-none">📝</span>
              Notes for AI
              {currentSheet && (notes[currentSheet.id] ?? "").trim() ? (
                <span className="text-lg leading-none text-brand-soft">•</span>
              ) : null}
            </button>
          )}
        </div>
      </div>

      {/* Right rail (collapsible + resizable): edit selected OR list */}
      {panelOpen ? (
        <>
          <div
            className="resize-handle z-10"
            onPointerDown={(e) => startResize("right", e)}
          />
          <aside
            className="glass z-10 flex shrink-0 flex-col"
            style={{ width: panelW }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
              {/* Next step — lives on top of the measurements panel */}
              <Link
                href={`/projects/${projectId}/scope`}
                className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand-soft transition-colors hover:bg-brand/25 hover:text-foreground"
              >
                Next step: Scope <span aria-hidden>→</span>
              </Link>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                title="Hide panel"
                className="rounded-md border border-white/10 px-2 py-0.5 text-muted transition-colors hover:border-brand hover:text-foreground"
              >
                »
              </button>
            </div>
            {selected ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Edit measurement</p>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-xs text-muted hover:text-brand-soft"
              >
                Done
              </button>
            </div>
            <p className="text-sm text-muted">
              {selected.type} ·{" "}
              <span className="text-foreground">
                {selected.value == null
                  ? "—"
                  : selected.type === "volume"
                    ? `${selected.value.toFixed(0)} cf · ${(
                        selected.value / CF_PER_CY
                      ).toFixed(2)} cy`
                    : selected.type === "count"
                      ? `${selected.value} ${selected.unit}`
                      : `${selected.value.toFixed(1)} ${selected.unit}`}
              </span>
            </p>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
              Layer
              <input
                value={selected.layer ?? ""}
                onChange={(e) => updateSelected({ layer: e.target.value })}
                placeholder="Layer name"
                className="rounded-md border border-border bg-background px-2 py-1 text-sm normal-case text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
              Color
              <div className="flex items-center gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateSelected({ color: c })}
                    style={{ background: c }}
                    className={`h-5 w-5 rounded-full ${
                      selected.color === c ? "ring-2 ring-foreground" : ""
                    }`}
                  />
                ))}
              </div>
            </div>
            {selected.type === "wall" ? (
              <>
                <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                  Height (ft)
                  <input
                    value={selected.wall_height ?? ""}
                    onChange={(e) =>
                      updateWall({ wall_height: parseFloat(e.target.value) || 0 })
                    }
                    inputMode="decimal"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm normal-case text-foreground focus:border-brand focus:outline-none"
                  />
                </label>
                <div className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                  Sides
                  <div className="flex items-center gap-1.5">
                    {(["single", "double"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateWall({ wall_sided: s })}
                        className={`rounded-md border px-2 py-1 text-xs capitalize transition-colors ${
                          (selected.wall_sided ?? "single") === s
                            ? "border-brand bg-brand/15 text-foreground"
                            : "border-border text-muted hover:border-brand"
                        }`}
                      >
                        {s}-sided
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            {selected.type === "volume" ? (
              <>
                <p className="text-xs uppercase tracking-wider text-muted">
                  {selected.vol_mode === "area" ? "Area × depth" : "Linear run"}
                </p>
                {selected.vol_mode !== "area" ? (
                  <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                    Width (ft)
                    <input
                      value={selected.vol_width ?? ""}
                      onChange={(e) =>
                        updateVolume({ vol_width: parseFloat(e.target.value) || 0 })
                      }
                      inputMode="decimal"
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm normal-case text-foreground focus:border-brand focus:outline-none"
                    />
                  </label>
                ) : null}
                <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                  Depth (ft)
                  <input
                    value={selected.vol_depth ?? ""}
                    onChange={(e) =>
                      updateVolume({ vol_depth: parseFloat(e.target.value) || 0 })
                    }
                    inputMode="decimal"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm normal-case text-foreground focus:border-brand focus:outline-none"
                  />
                </label>
              </>
            ) : null}
            {selected.type === "leader" ? (
              <>
                <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                  Text
                  <textarea
                    value={selected.text ?? ""}
                    onChange={(e) => updateLeader({ text: e.target.value })}
                    rows={2}
                    placeholder="Note…"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm normal-case text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
                  />
                </label>
                <div className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                  Font size
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateLeader({
                          font_size: Math.max(
                            6,
                            (selected.font_size ?? LEADER_FONT_DEFAULT) - 2,
                          ),
                        })
                      }
                      className="h-6 w-6 rounded-md border border-border text-foreground hover:border-brand"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm normal-case text-foreground">
                      {Math.round(selected.font_size ?? LEADER_FONT_DEFAULT)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateLeader({
                          font_size: Math.min(
                            96,
                            (selected.font_size ?? LEADER_FONT_DEFAULT) + 2,
                          ),
                        })
                      }
                      className="h-6 w-6 rounded-md border border-border text-foreground hover:border-brand"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
                  Leader head size
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateLeader({
                          head_size: Math.max(
                            4,
                            (selected.head_size ?? LEADER_HEAD_DEFAULT) - 2,
                          ),
                        })
                      }
                      className="h-6 w-6 rounded-md border border-border text-foreground hover:border-brand"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm normal-case text-foreground">
                      {Math.round(selected.head_size ?? LEADER_HEAD_DEFAULT)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateLeader({
                          head_size: Math.min(
                            60,
                            (selected.head_size ?? LEADER_HEAD_DEFAULT) + 2,
                          ),
                        })
                      }
                      className="h-6 w-6 rounded-md border border-border text-foreground hover:border-brand"
                    >
                      +
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            <p className="text-xs text-muted">
              {selected.type === "leader"
                ? "Tip: drag the white handles to move the arrow tip or the text box."
                : "Tip: drag the white handles on the sheet to reshape."}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={duplicateSelected}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:border-brand hover:text-brand-soft"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => deleteMeasurement(selected.id)}
                className="flex-1 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-sm text-brand-soft hover:bg-brand/20"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-sm font-medium text-foreground">Measurements</p>
              <p className="text-xs text-muted">
                {measurements.length} on this sheet · click one to edit
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {layerGroups.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted">
                  None yet. Pick a tool and draw on the sheet.
                </p>
              ) : (
                layerGroups.map((g) => {
                  const isHidden = hiddenLayers.has(g.layer);
                  const isEditing = editingLayer === g.layer;
                  const hasWall = g.rows.some((r) => r.type === "wall");
                  const hasVol = g.rows.some((r) => r.type === "volume");
                  const isRecording =
                    !isHidden &&
                    MEASURE_TOOLS.includes(tool) &&
                    layerKeyOf(layer) === g.layer;
                  return (
                    <div
                      key={g.layer}
                      className={`mb-1 rounded-md border border-white/5 ${isHidden ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        {/* Record toggle: red = drawing adds to this layer; green = idle */}
                        <button
                          type="button"
                          onClick={() =>
                            isRecording ? setTool("select") : continueLayer(g)
                          }
                          title={
                            isRecording
                              ? "Recording — new draws add to this layer. Click to stop."
                              : "Continue this layer — new draws add to it"
                          }
                          className="shrink-0"
                        >
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              isRecording
                                ? "animate-pulse bg-red-500"
                                : "bg-green-500/70"
                            }`}
                          />
                        </button>
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: g.color }}
                        />
                        <button
                          type="button"
                          onClick={() => openLayerEditor(g)}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm"
                          title={`${g.rows.length} runs — click to edit this layer (name, color, wall/volume settings, delete)`}
                        >
                          <span className="truncate text-foreground">
                            {g.layer}
                            <span className="ml-1 text-[10px] text-muted">
                              ({g.rows.length})
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs text-muted">
                            {g.lines.map((l) => (
                              <span key={l} className="block whitespace-nowrap">
                                {l}
                              </span>
                            ))}
                          </span>
                        </button>
                        {/* Visibility: hide from the sheet without losing anything */}
                        <button
                          type="button"
                          onClick={() =>
                            setHiddenLayers((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.layer)) next.delete(g.layer);
                              else next.add(g.layer);
                              return next;
                            })
                          }
                          title={isHidden ? "Show on sheet" : "Hide from sheet (keeps the values)"}
                          className={`shrink-0 text-xs ${isHidden ? "text-muted/50" : "text-muted hover:text-foreground"}`}
                        >
                          {isHidden ? "🚫" : "👁"}
                        </button>
                      </div>

                      {isEditing ? (
                        <div className="flex flex-col gap-2 border-t border-white/5 px-2 pb-2 pt-2">
                          {/* Rename — applies to every run in the layer */}
                          <div className="flex items-center gap-1.5">
                            <input
                              value={layerName}
                              onChange={(e) => setLayerName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  renameLayer(g.rows, layerName);
                                  setEditingLayer(null);
                                }
                                if (e.key === "Escape") setEditingLayer(null);
                              }}
                              placeholder="Layer name"
                              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                renameLayer(g.rows, layerName);
                                setEditingLayer(null);
                              }}
                              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-brand"
                            >
                              Rename
                            </button>
                          </div>

                          {/* Color — applies to every run */}
                          <div className="flex items-center gap-1">
                            {COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => recolorLayer(g.rows, c)}
                                style={{ background: c }}
                                className={`h-4 w-4 rounded-full ${g.color === c ? "ring-2 ring-foreground" : ""}`}
                              />
                            ))}
                          </div>

                          {/* Wall settings — recompute every run's area */}
                          {hasWall ? (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              <span className="uppercase tracking-wider">Height</span>
                              <input
                                value={layerHeight}
                                onChange={(e) => setLayerHeight(e.target.value)}
                                onBlur={() => {
                                  const h = parseFloat(layerHeight);
                                  if (Number.isFinite(h) && h > 0)
                                    updateLayerAttrs(g.rows, { wall_height: h });
                                }}
                                inputMode="decimal"
                                className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-foreground focus:border-brand focus:outline-none"
                              />
                              <span>ft</span>
                              {(["single", "double"] as const).map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => {
                                    setLayerSided(s);
                                    updateLayerAttrs(g.rows, { wall_sided: s });
                                  }}
                                  className={`rounded-md border px-2 py-1 capitalize transition-colors ${
                                    layerSided === s
                                      ? "border-brand bg-brand/15 text-foreground"
                                      : "border-border hover:border-brand"
                                  }`}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {/* Volume settings — recompute every run */}
                          {hasVol ? (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              <span className="uppercase tracking-wider">W</span>
                              <input
                                value={layerVolW}
                                onChange={(e) => setLayerVolW(e.target.value)}
                                onBlur={() => {
                                  const w = parseFloat(layerVolW);
                                  if (Number.isFinite(w) && w > 0)
                                    updateLayerAttrs(g.rows, { vol_width: w });
                                }}
                                inputMode="decimal"
                                className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-foreground focus:border-brand focus:outline-none"
                              />
                              <span className="uppercase tracking-wider">D</span>
                              <input
                                value={layerVolD}
                                onChange={(e) => setLayerVolD(e.target.value)}
                                onBlur={() => {
                                  const d = parseFloat(layerVolD);
                                  if (Number.isFinite(d) && d > 0)
                                    updateLayerAttrs(g.rows, { vol_depth: d });
                                }}
                                inputMode="decimal"
                                className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-foreground focus:border-brand focus:outline-none"
                              />
                              <span>ft</span>
                            </div>
                          ) : null}

                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted/70">
                              Click a run on the drawing to edit or delete just
                              that one.
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteLayer(g.rows)}
                              className="text-brand-soft transition-colors hover:text-foreground"
                            >
                              Delete layer
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </>
            )}
          </aside>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          title="Show measurements"
          className="glass-strong absolute right-2 top-2 z-20 rounded-md px-2.5 py-1 text-sm text-foreground"
        >
          « Panel
        </button>
      )}

      {/* Block measuring until a scale is set */}
      {needsScale ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-2xl p-6">
            <h2 className="font-heading text-lg text-foreground">Set a scale first</h2>
            <p className="mt-2 text-sm text-muted">
              This sheet has no scale yet. Measurements need one so lengths and
              areas come out accurate. Pick a standard scale, or calibrate from a
              known dimension on the drawing.
            </p>
            <label className="mt-4 flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">
              Standard scale
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) applyPreset(e.target.value);
                }}
                className="rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
              >
                <option value="">Choose a scale…</option>
                <optgroup label="Architectural">
                  {PRESETS.filter((p) => p.group === "Architectural").map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Civil / Engineering">
                  {PRESETS.filter((p) => p.group === "Civil").map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setTool("calibrate")}
                className="flex-1 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
              >
                Calibrate from the drawing
              </button>
              <button
                type="button"
                onClick={() => setTool("select")}
                className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:border-brand"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Right-click context menu */}
      {menu ? (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onPointerDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="glass-strong fixed z-[61] min-w-[170px] rounded-xl p-1 text-sm"
            style={{
              left: Math.min(
                menu.x,
                (typeof window !== "undefined" ? window.innerWidth : 99999) - 190,
              ),
              top: menu.y,
            }}
          >
            {menu.kind === "canvas" ? (
              <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted">
                Switch tool
              </p>
            ) : null}
            {menuItems.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  it.onClick();
                  setMenu(null);
                }}
                className={`block w-full rounded-lg px-3 py-1.5 text-left transition-colors ${
                  it.danger
                    ? "text-brand-soft hover:bg-brand/20"
                    : "text-foreground hover:bg-white/10"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* Export-to-PDF dialog */}
      {exportOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !exporting && setExportOpen(false)}
        >
          <div
            className="glass-strong w-full max-w-md rounded-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-heading text-lg text-foreground">
              Export marked-up PDF
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Pick the sheets to include. Each page is exported with its
              measurements, leaders, and legend flattened on, combined into one
              PDF.
            </p>
            <div className="mt-3 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setExportSel(new Set(sheets.map((s) => s.id)))}
                className="text-brand-soft hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setExportSel(new Set(markedSheets))}
                className="text-muted hover:text-foreground"
              >
                Only marked-up
              </button>
            </div>
            <div className="mt-2 max-h-72 space-y-1 overflow-auto rounded-lg border border-border p-2">
              {sheets.map((s) => {
                const on = exportSel.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-foreground hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setExportSel((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1 truncate">{sheetTitle(s)}</span>
                    {markedSheets.has(s.id) ? (
                      <span className="text-[10px] text-brand-soft">markup</span>
                    ) : (
                      <span className="text-[10px] text-muted/60">blank</span>
                    )}
                  </label>
                );
              })}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={exportLegend}
                onChange={(e) => setExportLegend(e.target.checked)}
              />
              Show takeoff legend on each page
            </label>

            <div className="mt-4 flex items-center justify-end gap-2">
              {exporting ? (
                <span className="mr-auto animate-pulse text-xs text-muted">
                  {exporting}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                disabled={!!exporting}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={exportMarkedPdf}
                disabled={!!exporting || exportSel.size === 0}
                className="glass-brand rounded-lg px-4 py-1.5 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
              >
                Export {exportSel.size} sheet{exportSel.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
