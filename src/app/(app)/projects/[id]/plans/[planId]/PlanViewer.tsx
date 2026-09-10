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
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";
import { getPdfjs } from "@/lib/pdfClient";
import { DISCIPLINE_OPTIONS } from "@/lib/scope/discipline";
import {
  CF_PER_CY,
  distToSeg,
  geomLenFeet,
  layerKeyOf,
  pointInPoly,
  polyAreaSqFt,
  polyCentroid,
  segFeet,
  type Pt,
} from "@/lib/takeoff/geometry";
import {
  createTouchGate,
  fingerDown as gateFingerDown,
  fingerUp as gateFingerUp,
  gestureBlocked as gateGestureBlocked,
  placementBlocked as gatePlacementBlocked,
} from "@/lib/takeoff/touchGate";
import {
  createFingerCensus,
  blocked as censusBlocked,
  mayPlace as censusMayPlace,
  tapBegan as censusTapBegan,
  touchesChanged as censusTouchesChanged,
  touchesEnded as censusTouchesEnded,
} from "@/lib/takeoff/fingerCensus";
import {
  buildLayerGroups,
  labelText,
  recomputeValue,
} from "@/lib/takeoff/measurements";
import SwipeRow from "@/components/SwipeRow";
import { polishSheetNotes } from "./actions";
import {
  SelectIcon,
  PanIcon,
  LineIcon,
  AreaIcon,
  CountIcon,
  PolylineIcon,
  WallIcon,
  VolumeIcon,
  LeaderIcon,
  CalibrateIcon,
  CropIcon,
  MoreIcon,
  type ToolIconProps,
} from "@/components/ToolIcons";
import type { PlanFile } from "@/types";

// On-sheet takeoff legend placement (fractions of the page + a size multiplier).
type Ledger = { x: number; y: number; scale: number; visible: boolean };
/** A cropped sheet's window onto its page: PDF points, top-left origin, page scale 1. */
type Crop = { x: number; y: number; w: number; h: number };
type Sheet = {
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
const PAPER: { id: string; label: string; w: number; h: number }[] = [
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
const PT_PER_IN = 72;

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
  | "leader"
  | "crop";

const MEAS_COLS =
  "id,type,geometry,value,unit,layer,color,wall_sided,wall_height,vol_mode,vol_width,vol_depth,text,font_size,head_size";
// Leader annotation defaults (PDF points). User grows/shrinks each per leader.
const LEADER_FONT_DEFAULT = 14;
const LEADER_HEAD_DEFAULT = 12;

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

// Group measurements into layer takeoff lines (shared by the side panel, the
// on-sheet legend, and the PDF export).
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
      // Areas carry their value in the middle of the shape, matching the
      // screen; everything else hangs its label off the anchor point.
      const inside =
        (m.type === "area" || (m.type === "volume" && m.vol_mode === "area")) &&
        g.length >= 3;
      const centered = inside || m.type === "count";
      const anchor = centered
        ? polyCentroid(g)
        : g.length >= 2
          ? { x: (g[0].x + g[1].x) / 2, y: (g[0].y + g[1].y) / 2 }
          : g[0];
      const a = P(anchor);
      const fs = 14 * k;
      ctx.font = `700 ${fs}px sans-serif`;
      ctx.textAlign = inside ? "center" : "left";
      ctx.textBaseline = inside ? "middle" : "alphabetic";
      const tx = inside ? a.x : a.x + 6 * k;
      const ty = inside ? a.y : a.y - 6 * k;
      ctx.lineWidth = 3.5 * k;
      ctx.strokeStyle = "#000";
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, tx, ty);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
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

/**
 * The layer-name field inside the picker.
 *
 * It deliberately keeps its own text state. `layer` lives on PlanViewer, and a
 * setState there re-renders the whole viewer — every SVG shape, the layer
 * totals, the measurements list — which on a phone made typing lag and drop
 * characters. The name is handed up only when it's COMMITTED (Done, Enter,
 * blur, or the picker closing), which is the only moment it has to be right.
 */
function LayerNameField({
  initial,
  existing,
  skipCommitRef,
  onCommit,
  onDone,
}: {
  initial: string;
  existing: string[];
  /** Set by the parent when a layer was picked from the list instead. */
  skipCommitRef: { current: boolean };
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const latest = useRef(text);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);
  // The picker can close without a blur (tap on the drawing) — commit then too,
  // unless the close came from picking an existing layer.
  useEffect(
    () => () => {
      if (skipCommitRef.current) {
        skipCommitRef.current = false;
        return;
      }
      commitRef.current(latest.current.trim());
    },
    [skipCommitRef],
  );

  const trimmed = text.trim();
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              onCommit(trimmed);
              onDone();
            }
          }}
          onBlur={() => onCommit(trimmed)}
          autoFocus={!initial.trim()}
          spellCheck
          autoCapitalize="sentences"
          enterKeyHint="done"
          placeholder="New layer name (e.g. Exterior wall)"
          aria-label="Layer name"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onCommit(trimmed);
            onDone();
          }}
          className="glass-brand min-h-10 shrink-0 rounded-md px-3 font-medium text-foreground"
        >
          Done
        </button>
      </div>
      <p className="px-1 pt-1 text-[10px] text-muted">
        {trimmed
          ? existing.includes(trimmed)
            ? `Continuing "${trimmed}" — new runs add to it.`
            : `New layer "${trimmed}" — saved with the first run you draw.`
          : "Type a name for the runs you're about to draw, or pick a layer below."}
      </p>
    </>
  );
}

export default function PlanViewer({
  projectId,
  planFile,
  sheets,
  initialPhone = false,
  initialCoarse = false,
}: {
  projectId: string;
  planFile: PlanFile;
  sheets: Sheet[];
  /** The server's guess from the request headers, so the first paint is already right. */
  initialPhone?: boolean;
  initialCoarse?: boolean;
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
  // `grab` is the offset from the pointer's aim point to the vertex at the
  // moment it was grabbed. Keeping it means the handle never jumps to the
  // finger on the first move — it travels with it from where it was picked up.
  const dragRef = useRef<{
    id: string;
    index: number;
    pointerId: number;
    grab: Pt;
  } | null>(null);
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
  // The side panels start CLOSED on anything the server took for a phone or
  // tablet; the effect below closes them on narrow windows once the
  // JavaScript runs, but that is what painted the desktop layout first.
  const [navOpen, setNavOpen] = useState(!initialCoarse);
  const [navW, setNavW] = useState(208);
  const [panelOpen, setPanelOpen] = useState(!initialCoarse);
  const [panelW, setPanelW] = useState(268);
  const [notesOpen, setNotesOpen] = useState(false);
  // Phone toolbar: the "More" sheet (zoom / legend / export / panels) and the
  // color popover — both keep the top of the screen to two short rows.
  const [moreOpen, setMoreOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false); // the layer picker popover
  const skipLayerCommitRef = useRef(false); // see LayerNameField

  // Narrow windows (tablet, half-screen laptop): start with both side panels
  // collapsed so the DRAWING gets the width, and collapse again if the window
  // is shrunk past the threshold. The user can still open them by hand.
  useEffect(() => {
    const NARROW = 1100;
    let wasNarrow = window.innerWidth < NARROW;
    if (wasNarrow) {
      setNavOpen(false);
      setPanelOpen(false);
    }
    const onResize = () => {
      const narrow = window.innerWidth < NARROW;
      if (narrow && !wasNarrow) {
        setNavOpen(false);
        setPanelOpen(false);
      }
      wasNarrow = narrow;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  // Sheets deleted in this session — hidden immediately, before the server
  // re-render catches up (router.refresh keeps the old list for a beat).
  const [removedSheetIds, setRemovedSheetIds] = useState<Set<string>>(new Set());
  // Sheets cropped in this session — shown immediately, before the server
  // re-render delivers them in `sheets`.
  const [addedSheets, setAddedSheets] = useState<Sheet[]>([]);
  // Which sheet is open. Several sheets can share a page (a page + its crops),
  // so the page number alone isn't enough.
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  // Crop tool: the rectangle being dragged (page points, relative to the
  // current canvas), the paper shape it's held to, and its orientation.
  const [cropDraft, setCropDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [cropPreset, setCropPreset] = useState("free");
  const [cropLandscape, setCropLandscape] = useState(true);
  const [cropName, setCropName] = useState("");
  const [cropBusy, setCropBusy] = useState(false);
  const cropDragRef = useRef(false);

  // ── Touch ──────────────────────────────────────────────────────────────────
  // `coarse` = a finger, not a mouse: bigger hit targets, a capped bitmap,
  // and the finger drawing model (place on LIFT, with a loupe to aim).
  // Both start from the server's guess (request headers) and are corrected
  // by the real screen once the JavaScript runs — without the guess, a
  // phone painted the desktop layout for as long as the bundle took to load.
  const [coarse, setCoarse] = useState(initialCoarse);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // `phone` = a narrow screen (below Tailwind's sm): the measurements panel
  // becomes a bottom sheet over the drawing instead of a side column.
  const [phone, setPhone] = useState(initialPhone);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // A popover under a control. On phones it is a bottom sheet rendered at the
  // document root with a real full-screen backdrop; on wider screens a
  // dropdown, dismissed by any press outside it. (A `fixed` backdrop placed
  // INSIDE the frosted options bar was clipped to the bar — the bar's
  // backdrop-filter makes it the containing block — so taps on the drawing
  // never closed the picker.)
  const popoverRef = useRef<HTMLDivElement>(null);
  const layerAnchorRef = useRef<DOMRect | null>(null); // the layer chip's box when opened
  function popover(close: () => void, body: React.ReactNode, width = "w-80", anchor?: DOMRect | null) {
    if (phone) {
      // Small popover pinned under its control (portaled so the backdrop is
      // truly full-screen); falls back to a bottom sheet with no anchor.
      const W = typeof window !== "undefined" ? window.innerWidth : 375;
      const H = typeof window !== "undefined" ? window.innerHeight : 800;
      const pw = Math.min(288, W - 16);
      const left = anchor ? Math.max(8, Math.min(anchor.left, W - 8 - pw)) : 8;
      const top = anchor ? Math.min(anchor.bottom + 4, H - 120) : undefined;
      return createPortal(
        <div
          className={`fixed inset-0 z-[70] ${anchor ? "" : "flex items-end justify-center bg-black/50"}`}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={popoverRef}
            role="dialog"
            className={
              anchor
                ? "glass-strong fixed max-h-[45vh] overflow-y-auto rounded-xl"
                : "glass-strong pb-safe max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl"
            }
            style={anchor ? { left, top, width: pw } : undefined}
          >
            {body}
          </div>
        </div>,
        document.body,
      );
    }
    return (
      <div
        ref={popoverRef}
        role="dialog"
        className={`glass-strong absolute left-0 top-full z-30 mt-1 rounded-xl ${width}`}
      >
        {body}
      </div>
    );
  }
  // Desktop dropdowns close on any press outside them.
  useEffect(() => {
    if (!layerOpen || phone) return;
    const onDown = (e: PointerEvent) => {
      const el = popoverRef.current;
      const t = e.target as Node | null;
      if (el && t && !el.contains(t) && !(t as HTMLElement).closest?.('[title="The layer new runs are added to"]'))
        setLayerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayerOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [layerOpen, phone]);
  // Fingers currently down on the viewport (client coords) → pinch when two.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist0: number; scale0: number; fx: number; fy: number } | null>(null);
  const pinchedRef = useRef(false); // a pinch happened during this touch — no point on lift
  // While two fingers are down the page is scaled/moved with a CSS transform
  // (GPU, no re-render, no re-raster); the real zoom is committed on lift.
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const pinchLiveRef = useRef<{ k: number; mx: number; my: number; dx: number; dy: number } | null>(null);
  // Select tool: two quick taps on the same shape open its menu.
  const lastSelTapRef = useRef<{ x: number; y: number; t: number; id: string } | null>(null);
  // Every finger on the whole viewer (drawing, pills, cards…), counted in the
  // capture phase. A second finger ANYWHERE cancels a one-finger aim, and for
  // a moment after a multi-touch ends nothing can be placed — so a two-finger
  // pan never leaves a stray point behind.
  const gateRef = useRef(createTouchGate());
  /** What the viewer's own pinch bookkeeping currently says. */
  function surroundings() {
    return {
      pointerCount: pointersRef.current.size,
      pinching: pinchRef.current != null,
    };
  }
  function gestureBlocked() {
    return gateGestureBlocked(gateRef.current, surroundings());
  }
  function placementBlocked() {
    return gatePlacementBlocked(gateRef.current, surroundings());
  }
  useEffect(() => {
    // The re-render carrying the new scale has happened by the time this runs,
    // so the measured rect and `scale` agree again and points land correctly.
    gateRef.current.zoomSettling = false;
  }, [scale]);

  function fingerDown(id: number) {
    if (gateFingerDown(gateRef.current, id, surroundings())) {
      // This touch is navigation: abandon whatever the first finger started.
      pinchedRef.current = true;
      cancelTouchEdits();
      selTapRef.current = null;
    }
  }
  /**
   * Two fingers mean navigate, and nothing else.
   *
   * Whatever the first finger had started — aiming a point, dragging a handle,
   * moving a shape, dragging a crop box — is abandoned the moment a second
   * finger lands, and any half-moved geometry is put back to what is saved. A
   * pinch can never leave a mark on the drawing.
   */
  function cancelTouchEdits() {
    cancelTouchTap();
    const editingId = dragRef.current?.id ?? moveRef.current?.id ?? null;
    if (editingId) {
      const m = measurementsRef.current.find((x) => x.id === editingId);
      setEditGeom(m ? m.geometry.map((q) => ({ ...q })) : null);
    }
    dragRef.current = null;
    dragStartRef.current = null;
    moveRef.current = null;
    cropDragRef.current = false;
    setCropDraft(null);
    setHover(null);
  }
  function fingerUp(id: number) {
    // The census runs in the CAPTURE phase, so this fires BEFORE the
    // viewport's own pointerup has removed this finger from `pointersRef`.
    // Discount it, or the two censuses can never both read zero and the latch
    // stays set for the life of the page — every later tap silently ignored.
    const others =
      pointersRef.current.size - (pointersRef.current.has(id) ? 1 : 0);
    gateFingerUp(gateRef.current, id, {
      pointerCount: others,
      pinching: pinchRef.current != null,
    });
    idleUntilRef.current = Date.now() + 400;
  }
  // The census that cannot miss a finger (src/lib/takeoff/fingerCensus.ts):
  // native touch events at the DOCUMENT, carrying the OS's own count of
  // fingers on the page. The pointer-event gate above stays as a second
  // opinion; this one is the authority. The moment the count reaches two,
  // whatever one finger had started is abandoned and the loupe + rubber band
  // go — so a pinch can neither place a point nor leave a phantom one drawn.
  const censusRef = useRef(createFingerCensus());
  const cancelTouchEditsRef = useRef<() => void>(() => {});
  useEffect(() => {
    cancelTouchEditsRef.current = cancelTouchEdits;
  });
  useEffect(() => {
    const c = censusRef.current;
    const onStart = (e: TouchEvent) => {
      if (censusTouchesChanged(c, e.touches.length)) {
        pinchedRef.current = true;
        cancelTouchEditsRef.current();
      }
    };
    const onEnd = (e: TouchEvent) => censusTouchesEnded(c, e.touches.length, Date.now());
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("touchstart", onStart, opts);
    document.addEventListener("touchmove", onStart, opts);
    document.addEventListener("touchend", onEnd, opts);
    document.addEventListener("touchcancel", onEnd, opts);
    return () => {
      document.removeEventListener("touchstart", onStart, opts);
      document.removeEventListener("touchmove", onStart, opts);
      document.removeEventListener("touchend", onEnd, opts);
      document.removeEventListener("touchcancel", onEnd, opts);
    };
  }, []);
  // Dictating sheet notes (Web Speech API → the AI tidies it into notes).
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "thinking" | "unsupported">("idle");
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const voiceFinalRef = useRef("");
  // A finger placing a point: down → (slide, loupe) → lift = place.
  const tapRef = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const rowPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // The magnifier that shows what's under the fingertip (center-column coords).
  // The loupe and the rubber band are driven WITHOUT React state while a
  // finger aims: their DOM is updated directly on each move (a state update
  // would re-render this whole component and its SVG at touch-event rate —
  // that was the lag while placing a point).
  const loupeElRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRafRef = useRef<number | null>(null);
  const rubberRef = useRef<SVGGElement>(null);
  // Where the finger has been during an aim (client px): the point placed on
  // lift is where the finger was HELD, not where it rolled off the glass.
  const aimSamplesRef = useRef<{ t: number; x: number; y: number }[]>([]);
  // The page bitmap is only re-rasterized once no finger is down and the
  // last gesture is this old — never in the middle of tapping.
  const idleUntilRef = useRef(0);
  // Auto edge-pan: while a finger aims a point or drags a handle within
  // EDGE_M px of the drawing's edge, the page slides that way (faster the
  // closer to the edge) so a run can continue past the visible area; it
  // stops when the finger moves back in, lifts, or the page can't scroll.
  const edgePanRef = useRef<{ raf: number | null; vx: number; vy: number; x: number; y: number } | null>(null);
  // ── Touch editing (see TOUCH-INTERACTION.md) ───────────────────────────────
  // The vertex the nudge pad works on (a tapped handle); hold-to-grab pulse;
  // whole-shape move; and the press-vs-drag bookkeeping for a handle.
  const [activeVertex, setActiveVertex] = useState<{ id: string; index: number } | null>(null);
  const [nudgeStep, setNudgeStep] = useState<"qft" | "ft" | "px">("qft");
  const [grabPulse, setGrabPulse] = useState(false);
  const moveRef = useRef<{ id: string; pointerId: number; start: Pt; orig: Pt[] } | null>(null);
  // A handle press: where it started (client px), whether it crossed the drag
  // threshold, and whether it came from a hold (lift without a slide = menu).
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean; hold: boolean; inserted?: boolean } | null>(null);
  // Select tool, finger: selection happens on LIFT (a second finger = pinch,
  // holding still = menu), so a press alone changes nothing.
  const selTapRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const moveArmedRef = useRef(false); // "Move" picked from the menu: the next drag moves the shape
  const nudgeSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeHistoryRef = useRef(false);
  // Export-to-PDF dialog state.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSel, setExportSel] = useState<Set<string>>(new Set());
  const [markedSheets, setMarkedSheets] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportLegend, setExportLegend] = useState(true);
  // The context menu is measured after it mounts and moved so all of it is
  // on-screen: opens upward from a low item, slides left from a right one.
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: "measurement" | "canvas" | "sheet" | "vertex";
    id?: string;
    index?: number; // vertex menus: which point
  } | null>(null);
  const [sheetNames, setSheetNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(sheets.map((s) => [s.id, s.name ?? ""])),
  );
  const [disciplines, setDisciplines] = useState<Record<string, string>>(() =>
    Object.fromEntries(sheets.map((s) => [s.id, s.discipline ?? ""])),
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
  // Latest list for async work (a save that returns after an undo, a drag on
  // a placeholder that hasn't been saved yet).
  const measurementsRef = useRef<Measurement[]>([]);
  useEffect(() => {
    measurementsRef.current = measurements;
  }, [measurements]);
  const isTemp = (id: string) => id.startsWith("tmp-");
  const [layer, setLayer] = useState("");
  const layerRef = useRef(layer); // for the sheet-load effect (no stale closure)
  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);
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
  // Undo / redo — snapshots of this sheet's measurements; on undo/redo the DB is
  // reconciled (re-insert / update / delete) to match. Reset when the sheet
  // changes. Latest undo/redo fns are mirrored to refs for the keyboard handler.
  const [undoStack, setUndoStack] = useState<Measurement[][]>([]);
  const [redoStack, setRedoStack] = useState<Measurement[][]>([]);
  const historyBusy = useRef(false);
  const undoFnRef = useRef<() => void>(() => {});
  const redoFnRef = useRef<() => void>(() => {});
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

  // The sheet list: what the server sent + crops made this session − deleted,
  // ordered by page then creation so a crop sits right under its page.
  const sheetList = useMemo(() => {
    const seen = new Set<string>();
    const all: Sheet[] = [];
    for (const s of [...sheets, ...addedSheets]) {
      if (seen.has(s.id) || removedSheetIds.has(s.id)) continue;
      seen.add(s.id);
      all.push(s);
    }
    return all.sort(
      (a, b) =>
        a.page_number - b.page_number ||
        (a.crop ? 1 : 0) - (b.crop ? 1 : 0) ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
  }, [sheets, addedSheets, removedSheetIds]);
  const currentSheet =
    sheetList.find((s) => s.id === activeSheetId) ??
    sheetList.find((s) => s.page_number === pageNum && !s.crop) ??
    sheetList.find((s) => s.page_number === pageNum) ??
    null;
  const crop = currentSheet?.crop ?? null;
  const cropKey = crop ? `${crop.x},${crop.y},${crop.w},${crop.h}` : "";
  const sheetIndex = sheetList.findIndex((s) => s.id === currentSheet?.id);
  function openSheet(s: Sheet) {
    setActiveSheetId(s.id);
    setPageNum(s.page_number);
  }
  const currentScale = currentSheet ? scales[currentSheet.id] : null;
  const currentLedger = currentSheet
    ? (ledgers[currentSheet.id] ?? DEFAULT_LEDGER)
    : null;
  const hasScale = !!(currentScale?.x && currentScale?.y);
  const selected = measurements.find((m) => m.id === selectedId) ?? null;
  // The nudge pad's vertex — only while its shape is still the selection.
  const activeV =
    activeVertex && selected && activeVertex.id === selected.id && activeVertex.index < selected.geometry.length
      ? activeVertex
      : null;
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
    setUndoStack([]);
    setRedoStack([]);
    setActiveVertex(null);
    if (!currentSheet) return;
    // Paging quickly fires one load per sheet; only the LATEST may land.
    // (Without this guard a slow earlier response could overwrite the current
    // sheet's measurements with another sheet's — or an empty list.)
    let live = true;
    (async () => {
      const { data } = await supabase
        .from("measurements")
        .select(MEAS_COLS)
        .eq("sheet_id", currentSheet.id)
        .order("created_at", { ascending: true });
      if (!live) return;
      const rows = (data as Measurement[]) ?? [];
      setMeasurements(rows);
      // Keep recording where the sheet left off: with no layer chosen yet
      // (fresh load, first visit to this sheet), the chip takes the newest
      // run's layer and color instead of falling back to "New layer…" — which
      // read as "my layer name didn't save" after a reload.
      const newest = rows[rows.length - 1];
      if (newest && !layerRef.current.trim()) {
        const key = layerKeyOf(newest.layer);
        setLayer(key === "Unlabeled" ? "" : key);
        if (newest.color) setColor(newest.color);
      }
    })();
    return () => {
      live = false;
    };
  }, [supabase, currentSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitWidth = useCallback(async () => {
    const pdf = pdfRef.current;
    const box = viewportRef.current;
    if (!pdf || !box) return;
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const w = crop ? crop.w : base.width;
    const h = crop ? crop.h : base.height;
    const next = Math.max(0.1, Math.min((box.clientWidth - 48) / w, 4));
    setBaseDims({ w, h });
    pendingCenterRef.current = true;
    setScale(next);
    setRasterScale(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, cropKey]);

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

  // Re-center when switching sheets/pages (a crop of the same page counts).
  useEffect(() => {
    pendingCenterRef.current = true;
    setCropDraft(null);
  }, [pageNum, activeSheetId]);

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
      // A cropped sheet shows just its window: shift the page so the crop's
      // corner lands at the canvas origin, and size the canvas to the crop.
      // Measurements on a cropped sheet are stored in this crop-local space.
      const w = crop ? crop.w : base.width;
      const h = crop ? crop.h : base.height;
      setBaseDims({ w, h });
      const viewport = page.getViewport({
        scale: rasterScale,
        offsetX: crop ? -crop.x * rasterScale : 0,
        offsetY: crop ? -crop.y * rasterScale : 0,
      });
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Double-buffered: draw into an offscreen bitmap and swap it in when
      // done. Sizing the visible canvas first would blank the sheet for the
      // whole render — the "page disappears after a pinch" effect on phones.
      const buf = document.createElement("canvas");
      buf.width = Math.ceil(w * rasterScale);
      buf.height = Math.ceil(h * rasterScale);
      const ctx = buf.getContext("2d");
      if (!ctx) return;
      if (taskRef.current) {
        try {
          taskRef.current.cancel();
        } catch {}
      }
      const task = page.render({ canvasContext: ctx, viewport });
      taskRef.current = task;
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      canvas.width = buf.width;
      canvas.height = buf.height;
      canvas.getContext("2d")?.drawImage(buf, 0, 0);
      buf.width = 0; // release the buffer's memory now, not at GC time
      buf.height = 0;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pageNum, rasterScale, cropKey]);

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
  // Touch devices cap the bitmap: phones and iPads fail past ~12–16M canvas
  // pixels (a 24×36 sheet at 3× is 40M). The CSS size still follows `scale`;
  // only sharpness beyond the cap is traded away.
  useEffect(() => {
    const maxPixels = coarse ? 12_000_000 : 40_000_000;
    const cap =
      baseDims.w && baseDims.h ? Math.sqrt(maxPixels / (baseDims.w * baseDims.h)) : Infinity;
    const target = Math.min(scale, cap);
    if (target === rasterScale) return;
    // …and only once the user is idle: no finger on the drawing and the last
    // gesture at least 400 ms old. Rasterizing is the heaviest thing this
    // page does; running it under a tap is what made taps feel dead.
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (gateRef.current.fingers.size > 0 || Date.now() < idleUntilRef.current) {
        t = setTimeout(tick, 120);
        return;
      }
      setRasterScale(target);
    };
    t = setTimeout(tick, 160);
    return () => clearTimeout(t);
  }, [scale, rasterScale, coarse, baseDims.w, baseDims.h]);


  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const pad = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let left = menu.x;
    let top = menu.y;
    if (left + w > W - pad) left = Math.max(pad, W - pad - w);
    if (top + h > H - pad) top = Math.max(pad, menu.y - h); // flip above the finger
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [menu]);

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

  // Keep the keyboard handler pointed at the latest undo/redo closures.
  useEffect(() => {
    undoFnRef.current = undo;
    redoFnRef.current = redo;
  });

  // Ctrl/Cmd+Z = undo · Ctrl+Shift+Z or Ctrl+Y = redo (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undoFnRef.current();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redoFnRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  async function saveSheetDiscipline(id: string, value: string) {
    setDisciplines((p) => ({ ...p, [id]: value }));
    await supabase
      .from("sheets")
      .update({ discipline: value.trim() || null })
      .eq("id", id);
  }
  function onPickDiscipline(id: string, value: string) {
    if (value === "__add__") {
      const custom = window
        .prompt('Category for this sheet (e.g. "Pile schedule"):')
        ?.trim();
      if (custom) void saveSheetDiscipline(id, custom);
      return;
    }
    void saveSheetDiscipline(id, value);
  }
  // The user's own categories (anything not one of the built-in disciplines),
  // offered on every sheet so they're reusable.
  const presetDisciplines = new Set(
    DISCIPLINE_OPTIONS.map((o) => o.value as string),
  );
  const customCategories = [
    ...new Set(
      Object.values(disciplines)
        .map((v) => v.trim())
        .filter((v) => v && !presetDisciplines.has(v)),
    ),
  ];

  // ── Dictated notes ────────────────────────────────────────────────────────
  // The browser's speech recognition (Safari/Chrome) turns speech into text;
  // when it stops — Stop button, or a pause — the AI tidies the transcript
  // into notes about THIS sheet and appends them to the box.
  function startVoice() {
    type SRResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
    type SR = {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((ev: { results: SRResultList }) => void) | null;
      onerror: ((ev: { error?: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceState("unsupported");
      return;
    }
    setVoiceErr(null);
    voiceFinalRef.current = "";
    setVoiceInterim("");
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let done = "";
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) done += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      voiceFinalRef.current = done;
      setVoiceInterim((done + interim).trim());
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") setVoiceErr("Microphone access was blocked — allow it in the browser and try again.");
      else if (ev.error !== "no-speech" && ev.error !== "aborted") setVoiceErr("Couldn't hear that — try again.");
    };
    rec.onend = () => {
      recRef.current = null;
      void finishVoice();
    };
    try {
      rec.start();
      recRef.current = rec;
      setVoiceState("listening");
    } catch {
      setVoiceErr("Couldn't start the microphone.");
    }
  }
  function stopVoice() {
    recRef.current?.stop();
  }
  async function finishVoice() {
    const transcript = (voiceFinalRef.current.trim() || voiceInterim).trim();
    setVoiceInterim("");
    if (!transcript || !currentSheet) {
      setVoiceState("idle");
      return;
    }
    setVoiceState("thinking");
    const existing = notes[currentSheet.id] ?? "";
    const res = await polishSheetNotes({
      projectId,
      sheetId: currentSheet.id,
      transcript,
      existing,
    });
    if (!res.ok || !res.notes) {
      setVoiceErr(res.error ?? "Couldn't turn that into notes.");
      setVoiceState("idle");
      return;
    }
    const next = existing.trim() ? `${existing.trimEnd()}\n${res.notes}` : res.notes;
    onNotesChange(next);
    await saveNotes(next);
    setVoiceState("idle");
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
    // The active layer sticks across tool switches (keep recording into the
    // same layer); only an empty layer gets a fresh color.
    if (MEASURE_TOOLS.includes(t) && !layer.trim()) setColor(pickNextColor());
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
    // Null-safe: a pointer event can land after the overlay is gone (sheet
    // switch mid-gesture) — better a harmless point than a crash.
    const rect = svgRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }
  // Selection tolerance in page points: a fingertip needs twice a cursor's.
  const TOL = () => (coarse ? 16 : 8) / scale;

  // The vertex under a point (within the handle's hit radius), or null. The
  // selected shape's handles win — they're drawn on top. `onlySelected` limits
  // the search to the selection (the Select tool's handle press).
  function vertexAt(pt: Pt, onlySelected = false): { id: string; index: number } | null {
    const r = TOL() * 1.6;
    const scan = (m: Measurement) => {
      let best: { index: number; d: number } | null = null;
      m.geometry.forEach((v, i) => {
        const d = Math.hypot(v.x - pt.x, v.y - pt.y);
        if (d <= r && (!best || d < best.d)) best = { index: i, d };
      });
      return best;
    };
    if (selected) {
      const b = scan(selected);
      if (b) return { id: selected.id, index: (b as { index: number }).index };
    }
    if (onlySelected) return null;
    let found: { id: string; index: number; d: number } | null = null;
    for (const m of measurements) {
      if (hiddenLayers.has(layerKeyOf(m.layer))) continue;
      const b = scan(m) as { index: number; d: number } | null;
      if (b && (!found || b.d < found.d)) found = { id: m.id, index: b.index, d: b.d };
    }
    return found ? { id: found.id, index: found.index } : null;
  }

  // A "+" midpoint of the selected shape under the point: where a new vertex
  // goes (insert index) if the finger lands on it. Only segments long enough
  // on screen to show a midpoint count.
  // Shortest segment (screen px) that gets a "+" midpoint: its middle must sit
  // clear of both corners' hit circles, with a little air, or a press there
  // would grab a corner instead.
  const MID_SEG_MIN = () => (coarse ? 16 : 8) * 1.6 * 2 + 24;
  // How far past an open path's ends its "continue" handles sit (screen px):
  // outside the end vertex's hit circle, with a little air.
  const END_EXT = () => (coarse ? 16 : 8) * 1.6 + 14;
  // The "+" handles of the selected shape: one on the middle of each
  // long-enough edge (insert there), and for open paths (polyline, wall,
  // linear volume) one just past each end (continue the run from there).
  function plusHandles(m: Measurement): { at: number; p: Pt; end?: "start" | "end" }[] {
    if (m.type === "count" || m.type === "leader" || m.type === "line") return [];
    const g = m.geometry;
    const closed = m.type === "area" || (m.type === "volume" && m.vol_mode === "area");
    const out: { at: number; p: Pt; end?: "start" | "end" }[] = [];
    const n = closed ? g.length : g.length - 1;
    for (let i = 0; i < n; i++) {
      const a = g[i];
      const b = g[(i + 1) % g.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) * scale < MID_SEG_MIN()) continue;
      out.push({ at: i + 1, p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
    }
    if (!closed && g.length >= 2) {
      const ext = END_EXT() / scale;
      const dir = (from: Pt, to: Pt): Pt => {
        const L = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        return { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
      };
      const dEnd = dir(g[g.length - 2], g[g.length - 1]);
      out.push({ at: g.length, end: "end", p: { x: g[g.length - 1].x + dEnd.x * ext, y: g[g.length - 1].y + dEnd.y * ext } });
      const dStart = dir(g[1], g[0]);
      out.push({ at: 0, end: "start", p: { x: g[0].x + dStart.x * ext, y: g[0].y + dStart.y * ext } });
    }
    return out;
  }
  function midpointAt(pt: Pt): { at: number; p: Pt } | null {
    if (!selected) return null;
    // Tight on purpose: the "+" is small, and a press anywhere else on the
    // shape must still select / hold-for-menu rather than add a corner.
    const r = TOL() * 0.9;
    let best: { at: number; p: Pt; d: number } | null = null;
    for (const h of plusHandles(selected)) {
      const d = Math.hypot(h.p.x - pt.x, h.p.y - pt.y);
      if (d <= r && (!best || d < best.d)) best = { at: h.at, p: h.p, d };
    }
    return best ? { at: best.at, p: best.p } : null;
  }

  // Fewest points a shape can keep (delete-a-point stops here).
  function minPointsOf(m: Measurement): number {
    if (m.type === "count") return 1;
    if (m.type === "area" || (m.type === "volume" && m.vol_mode === "area")) return 3;
    return 2;
  }

  // A shape's value for a (new) geometry — the same math the draw tools use.
  function geometryValue(m: Measurement, geometry: Pt[]): number | null {
    if (m.type === "leader") return null; // leaders carry text, not a measured value
    if (m.type === "count") return geometry.length;
    if (!currentScale?.x || !currentScale?.y) return m.value;
    const sx = currentScale.x;
    const sy = currentScale.y;
    return m.type === "area"
      ? polyAreaSqFt(geometry, sx, sy)
      : m.type === "wall"
        ? geomLenFeet(geometry, sx, sy) * (m.wall_height ?? 0) * (m.wall_sided === "double" ? 2 : 1)
        : m.type === "volume"
          ? m.vol_mode === "area"
            ? polyAreaSqFt(geometry, sx, sy) * (m.vol_depth ?? 0)
            : geomLenFeet(geometry, sx, sy) * (m.vol_width ?? 0) * (m.vol_depth ?? 0)
          : geomLenFeet(geometry, sx, sy);
  }

  // Save a reshaped measurement: history, local state, then the database.
  // `debounceMs` batches a burst of nudges into one save (one undo step).
  async function commitGeometry(id: string, geometry: Pt[], debounceMs = 0) {
    const m = measurements.find((x) => x.id === id);
    if (!m) return;
    const value = geometryValue(m, geometry);
    if (debounceMs > 0) {
      if (!nudgeHistoryRef.current) {
        recordHistory();
        nudgeHistoryRef.current = true;
      }
      setMeasurements((arr) => arr.map((x) => (x.id === id ? { ...x, geometry, value } : x)));
      if (nudgeSaveRef.current) clearTimeout(nudgeSaveRef.current);
      nudgeSaveRef.current = setTimeout(async () => {
        nudgeSaveRef.current = null;
        nudgeHistoryRef.current = false;
        await supabase.from("measurements").update({ geometry, value }).eq("id", id);
      }, debounceMs);
      return;
    }
    recordHistory();
    setMeasurements((arr) => arr.map((x) => (x.id === id ? { ...x, geometry, value } : x)));
    await supabase.from("measurements").update({ geometry, value }).eq("id", id);
  }

  // Nudge pad: move the active vertex one step. Steps are ¼ ft / 1 ft on a
  // scaled sheet (converted with the sheet's points-per-foot), or one screen
  // pixel at the current zoom.
  const nudgeUnit = hasScale ? nudgeStep : "px";
  function nudgeActive(dx: number, dy: number) {
    if (!activeV || !selected) return;
    let sx: number;
    let sy: number;
    if (nudgeUnit === "px") {
      sx = sy = 1 / scale;
    } else {
      const ft = nudgeUnit === "ft" ? 1 : 0.25;
      sx = ft * (currentScale?.x ?? 0);
      sy = ft * (currentScale?.y ?? 0);
    }
    if (!sx || !sy) return;
    const geometry = selected.geometry.map((q, i) =>
      i === activeV.index ? { x: q.x + dx * sx, y: q.y + dy * sy } : { ...q },
    );
    commitGeometry(selected.id, geometry, 500);
  }

  // Vertex menu: drop this point (down to the shape's minimum) or split the
  // segment after it with a new midpoint.
  function deleteVertex(id: string, index: number) {
    const m = measurements.find((x) => x.id === id);
    if (!m) return;
    if (m.geometry.length <= minPointsOf(m)) {
      if (m.type === "count") deleteMeasurement(id); // last marker → the count goes
      return;
    }
    setActiveVertex(null);
    commitGeometry(id, m.geometry.filter((_, i) => i !== index));
  }
  function splitAfterVertex(id: string, index: number) {
    const m = measurements.find((x) => x.id === id);
    if (!m || m.type === "count" || m.type === "leader" || m.type === "line") return;
    const g = m.geometry;
    const closed = m.type === "area" || (m.type === "volume" && m.vol_mode === "area");
    const j = index + 1 < g.length ? index + 1 : closed ? 0 : index - 1;
    if (j < 0) return;
    const mid = { x: (g[index].x + g[j].x) / 2, y: (g[index].y + g[j].y) / 2 };
    const at = index + 1 < g.length || closed ? index + 1 : index;
    const next = [...g.slice(0, at), mid, ...g.slice(at)];
    setActiveVertex({ id, index: at });
    commitGeometry(id, next);
  }

  async function insertMeasurement(
    type: string,
    geometry: Pt[],
    value: number,
    unit = "ft",
    extra: Partial<Measurement> = {},
  ) {
    if (!currentSheet) return;
    // Optimistic: the shape appears and the draft clears NOW, not when the
    // network answers. (Clearing the draft after the await wiped whatever
    // the user had started drawing next on a slow connection, and the saved
    // shape "vanished" until the round trip came back.)
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Measurement = {
      id: tempId,
      type,
      geometry,
      value,
      unit,
      layer: layer.trim() || null,
      color,
      wall_sided: null,
      wall_height: null,
      vol_mode: null,
      vol_width: null,
      vol_depth: null,
      ...extra,
    };
    recordHistory();
    setMeasurements((m) => [...m, optimistic]);
    setDraft([]);
    setHover(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMeasurements((m) => m.filter((x) => x.id !== tempId));
      setError("Not signed in — that measurement wasn't saved.");
      return;
    }
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
        layer: layer.trim() || null,
        color,
        ...extra,
      })
      .select(MEAS_COLS)
      .single();
    if (insErr || !data) {
      setMeasurements((m) => m.filter((x) => x.id !== tempId));
      setError("Could not save that measurement.");
      return;
    }
    const saved = data as Measurement;
    const live = measurementsRef.current.find((x) => x.id === tempId);
    if (!live) {
      // Undone or deleted while the save was in flight: the row must not
      // linger in the database.
      await supabase.from("measurements").delete().eq("id", saved.id);
      return;
    }
    if (live.geometry !== geometry) {
      // Reshaped while pending: the database gets the newer geometry.
      saved.geometry = live.geometry;
      saved.value = geometryValue(saved, live.geometry);
      await supabase
        .from("measurements")
        .update({ geometry: saved.geometry, value: saved.value })
        .eq("id", saved.id);
    }
    // Swap the placeholder for the saved row (keeps its real id for edits).
    setMeasurements((m) => m.map((x) => (x.id === tempId ? saved : x)));
    if (selectedId === tempId) setSelectedId(saved.id);
    // Drawing into a hidden layer shows it again — a run that vanishes the
    // moment it is saved looks like it was lost.
    const key = layerKeyOf(layer || null);
    if (hiddenLayers.has(key))
      setHiddenLayers((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
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
    // Draft clears and the arrow shows right away; the note card opens once
    // the row exists (its text edits need the real id).
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    recordHistory();
    setMeasurements((m) => [
      ...m,
      {
        id: tempId,
        type: "leader",
        geometry,
        value: null,
        unit: null,
        layer: layer.trim() || null,
        color,
        wall_sided: null,
        wall_height: null,
        vol_mode: null,
        vol_width: null,
        vol_depth: null,
        text: "",
        font_size: LEADER_FONT_DEFAULT,
        head_size: LEADER_HEAD_DEFAULT,
      },
    ]);
    setDraft([]);
    setHover(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMeasurements((m) => m.filter((x) => x.id !== tempId));
      setError("Not signed in — that leader wasn't saved.");
      return;
    }
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
        layer: layer.trim() || null,
        color,
        text: "",
        font_size: LEADER_FONT_DEFAULT,
        head_size: LEADER_HEAD_DEFAULT,
      })
      .select(MEAS_COLS)
      .single();
    if (insErr || !data) {
      setMeasurements((m) => m.filter((x) => x.id !== tempId));
      setError("Could not add the leader. (Has migration 0023 been run?)");
      return;
    }
    if (!measurementsRef.current.some((x) => x.id === tempId)) {
      await supabase.from("measurements").delete().eq("id", (data as Measurement).id); // undone meanwhile
      return;
    }
    // Drop straight into Select so the user can type the note.
    const md = data as Measurement;
    setMeasurements((m) => m.map((x) => (x.id === tempId ? md : x)));
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
    recordHistory();
    const active = activeCountRef.current;
    if (active) {
      // Mouse: clicking an existing marker removes it. Finger: a tap always
      // ADDS — a fingertip landing near a marker was removing it by accident,
      // which read as "the count is confused". Remove a marker by holding it
      // (Delete this marker) or from the nudge pad.
      const idx = coarse
        ? -1
        : active.geometry.findIndex((v) => Math.hypot(v.x - pt.x, v.y - pt.y) <= TOL() * 1.6);
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
        layer: layer.trim() || null,
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

  // ---- crop tool helpers ----
  // Hold the dragged corner to the chosen paper shape (w:h), keeping the drag
  // direction. "Free" leaves it alone.
  function constrainCrop(a: Pt, b: Pt): Pt {
    const p = PAPER.find((x) => x.id === cropPreset);
    if (!p || !p.w) return b;
    const ratio = cropLandscape ? p.h / p.w : p.w / p.h; // width ÷ height
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
    const h = w / ratio;
    return { x: a.x + Math.sign(dx || 1) * w, y: a.y + Math.sign(dy || 1) * h };
  }
  // The draft as a rectangle in the CURRENT canvas's page space, clamped to it.
  const cropRect = (() => {
    if (!cropDraft) return null;
    const x0 = Math.max(0, Math.min(cropDraft.a.x, cropDraft.b.x));
    const y0 = Math.max(0, Math.min(cropDraft.a.y, cropDraft.b.y));
    const x1 = Math.min(baseDims.w, Math.max(cropDraft.a.x, cropDraft.b.x));
    const y1 = Math.min(baseDims.h, Math.max(cropDraft.a.y, cropDraft.b.y));
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  })();

  /** Save the dragged rectangle as a NEW sheet of this page (the original is untouched). */
  async function createCroppedSheet() {
    if (!cropRect || !currentSheet || cropBusy) return;
    setCropBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session expired — please sign in again.");
      // A crop of a crop: store it in full-page coordinates.
      const abs: Crop = {
        x: Math.round(((crop?.x ?? 0) + cropRect.x) * 100) / 100,
        y: Math.round(((crop?.y ?? 0) + cropRect.y) * 100) / 100,
        w: Math.round(cropRect.w * 100) / 100,
        h: Math.round(cropRect.h * 100) / 100,
      };
      const name = cropName.trim() || `${sheetTitle(currentSheet)} — crop`;
      const sc = scales[currentSheet.id];
      const { data, error } = await supabase
        .from("sheets")
        .insert({
          project_id: projectId,
          plan_file_id: planFile.id,
          owner_id: user.id,
          page_number: currentSheet.page_number,
          name,
          label: currentSheet.label,
          discipline: (disciplines[currentSheet.id] ?? "").trim() || null,
          // Same page, same drawing scale — carry it over so measuring works immediately.
          scale_x: sc?.x ?? null,
          scale_y: sc?.y ?? null,
          scale_preset: sc?.preset ?? null,
          crop: abs,
          source_sheet_id: currentSheet.id,
        })
        .select(
          "id,page_number,name,label,notes,discipline,scale_x,scale_y,scale_preset,ledger,crop,source_sheet_id,created_at",
        )
        .single();
      if (error || !data) {
        const msg = error?.message ?? "";
        throw new Error(
          /column|schema cache/i.test(msg)
            ? "Cropping needs one database change first: run migration 0035_sheet_crop.sql in Supabase (see PENDING-DB-CHANGES.md)."
            : `Could not save the crop: ${msg}`,
        );
      }
      const s = data as Sheet;
      setAddedSheets((prev) => [...prev, s]);
      setSheetNames((p) => ({ ...p, [s.id]: s.name ?? "" }));
      setDisciplines((p) => ({ ...p, [s.id]: s.discipline ?? "" }));
      setNotes((p) => ({ ...p, [s.id]: "" }));
      setScales((p) => ({ ...p, [s.id]: { x: s.scale_x, y: s.scale_y, preset: s.scale_preset } }));
      setLedgers((p) => ({ ...p, [s.id]: DEFAULT_LEDGER }));
      setCropDraft(null);
      setCropName("");
      setTool("select");
      openSheet(s);
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCropBusy(false);
    }
  }

  // ---- touch helpers ----
  // Long-press (450 ms, finger still). On a vertex of any shape: GRAB it — the
  // finger can slide it right away, in any tool; lifting without a slide opens
  // the vertex menu. On a shape: its menu. On empty canvas: the tool switcher.
  function startLongPress(cx: number, cy: number, pointerId?: number) {
    cancelLongPress();
    longPressFiredRef.current = false;
    longPressRef.current = setTimeout(() => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      // A hold is always a finger: hit-test at the crosshair, not the patch.
      const pt = { x: (cx - rect.left) / scale, y: (cy - aimLiftRef.current - rect.top) / scale };
      // Drawing tools: holding still is how a finger AIMS with the loupe, so
      // a hold must not open anything mid-shape, and never on empty paper —
      // and the lift that follows still places the point (nothing "fired").
      // Grabbing an existing vertex, or a shape's menu, still works between
      // shapes; Select keeps the full hold behaviour.
      const drawing = tool !== "select" && tool !== "browse" && tool !== "crop";
      if (drawing && draft.length > 0) return;
      const v = pointerId != null && tool !== "crop" ? vertexAt(pt) : null;
      if (drawing && !v && !pickMeasurementAt(pt)) return;
      longPressFiredRef.current = true;
      if (v && pointerId != null) {
        const m = measurements.find((x) => x.id === v.id);
        if (m) {
          tapRef.current = null; // no point gets placed on lift
          selTapRef.current = null;
          setSelectedId(m.id);
          setActiveVertex(v);
          {
            dragRef.current = {
              id: m.id,
              index: v.index,
              pointerId,
              grab: { x: 0, y: 0 }, // the vertex rides the crosshair
            };
          }
          dragStartRef.current = { x: cx, y: cy, moved: false, hold: true };
          setEditGeom(m.geometry.map((q) => ({ ...q })));
          setGrabPulse(true);
          setTimeout(() => setGrabPulse(false), 400);
          showLoupeAt(cx, cy, clientToPoint(cx, cy - aimLiftRef.current));
          return;
        }
      }
      const id = pickMeasurementAt(pt);
      if (id) {
        // Holding a shape makes it editable right away (handles on), and
        // offers its menu on top.
        setTool("select");
        setSelectedId(id);
      }
      setMenu(id ? { x: cx, y: cy, kind: "measurement", id } : { x: cx, y: cy, kind: "canvas" });
      hideLoupe();
    }, 450);
  }
  function cancelLongPress() {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }
  function cancelTouchTap() {
    tapRef.current = null;
    cancelLongPress();
    hideLoupe();
    clearRubber();
    aimSamplesRef.current = [];
    edgePanStop();
  }
  // ── Auto edge-pan ─────────────────────────────────────────────────────────
  function edgePanStop() {
    const s = edgePanRef.current;
    if (s?.raf != null) cancelAnimationFrame(s.raf);
    edgePanRef.current = null;
  }
  function edgePanUpdate(clientX: number, clientY: number) {
    const vp = viewportRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const EDGE_M = 48; // px from the edge where panning starts
    const MAX = 14; // px per frame at the very edge
    const speed = (d: number) => (d < EDGE_M ? ((EDGE_M - Math.max(0, d)) / EDGE_M) * MAX : 0);
    const l = speed(clientX - r.left);
    const rt = speed(r.right - clientX);
    const t = speed(clientY - r.top);
    const b = speed(r.bottom - clientY);
    const vx = l ? -l : rt;
    const vy = t ? -t : b;
    if (!vx && !vy) {
      edgePanStop();
      return;
    }
    const cur = edgePanRef.current;
    if (cur) {
      cur.vx = vx;
      cur.vy = vy;
      cur.x = clientX;
      cur.y = clientY;
      return;
    }
    const st = { raf: null as number | null, vx, vy, x: clientX, y: clientY };
    edgePanRef.current = st;
    const tick = () => {
      const s = edgePanRef.current;
      const v = viewportRef.current;
      if (!s || !v) return;
      const sl = v.scrollLeft;
      const stp = v.scrollTop;
      v.scrollLeft += s.vx;
      v.scrollTop += s.vy;
      if (v.scrollLeft === sl && v.scrollTop === stp) {
        edgePanStop(); // reached the end of the page
        return;
      }
      // The page moved under the still finger: re-aim at the same screen spot.
      const ay = s.y - aimLiftRef.current;
      const pt = clientToPoint(s.x, ay);
      if (tapRef.current) {
        recordAim(s.x, ay);
        showLoupeAt(s.x, s.y, pt);
        if (draft.length) updateRubber(pt);
      } else if (dragRef.current) {
        const idx = dragRef.current.index;
        const grab = dragRef.current.grab;
        const vp = { x: pt.x + grab.x, y: pt.y + grab.y };
        setEditGeom((g) => {
          if (!g) return g;
          const ng = g.map((q) => ({ ...q }));
          ng[idx] = vp;
          return ng;
        });
        showLoupeAt(s.x, s.y, vp);
      }
      s.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  }
  function clientToPoint(x: number, y: number): Pt {
    const rect = svgRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: (x - rect.left) / scale, y: (y - rect.top) / scale };
  }

  // ── Where a finger is actually aiming ─────────────────────────────────────
  // A fingertip covers roughly a 12 mm circle of glass, so a point placed at
  // the contact patch is under the finger that placed it — you cannot see the
  // thing you are trying to hit. The aim point is therefore lifted a fixed
  // distance ABOVE the contact point: the loupe's crosshair, the rubber band
  // and the placed point all use the lifted spot, and the target stays in
  // clear view the whole time. This is what Bluebeam and the iOS text
  // magnifier do, and it is the difference between guessing and aiming.
  //
  // Screen pixels, so it stays the same physical distance at every zoom.
  // Touch only — a stylus and a mouse already point exactly where you can see.
  //
  // 2026-09-10 (Erfan, on his phone): the loupe is a LENS. The point that gets
  // selected is the one under the CENTRE of the loupe window on screen, and
  // the loupe shows exactly that spot magnified — not a spot a little above
  // the finger that the loupe then displays somewhere else. So the lift is
  // simply the loupe's own offset from the finger: above it normally, below
  // it near the top edge of the screen where the window flips so it stays on
  // screen. One function gives both the window position and the aim point,
  // so the two can never disagree.
  const LOUPE_SIZE = 120;
  const LOUPE_ABOVE = 90; // finger → lens centre (window top sits 150 px above the finger)
  const LOUPE_BELOW = 110; // finger → lens centre when flipped (window top 50 px below)
  const LOUPE_FLIP_AT = 170; // flip when the finger is this close to the top of the drawing
  function loupeLift(clientY: number): number {
    const host = viewportRef.current?.parentElement;
    const top = host ? host.getBoundingClientRect().top : 0;
    return clientY - top < LOUPE_FLIP_AT ? -LOUPE_BELOW : LOUPE_ABOVE;
  }
  const aimLiftRef = useRef(0);
  function liftOf(e: React.PointerEvent) {
    return e.pointerType === "touch" ? loupeLift(e.clientY) : 0;
  }
  /** The page point a pointer is aiming at, contact patch accounted for. */
  function evtToAim(e: React.PointerEvent): Pt {
    return clientToPoint(e.clientX, e.clientY - liftOf(e));
  }
  function recordAim(x: number, y: number) {
    const s = aimSamplesRef.current;
    s.push({ t: Date.now(), x, y });
    if (s.length > 24) s.shift();
  }
  // The point the finger meant: the position it was holding ~80 ms before the
  // lift, unless it clearly moved since (a deliberate slide). Fingers roll a
  // few pixels as they leave the glass; this ignores that.
  function stableAimPoint(upX: number, upY: number): { x: number; y: number } {
    const now = Date.now();
    const s = aimSamplesRef.current;
    for (let i = s.length - 1; i >= 0; i--) {
      const q = s[i];
      if (now - q.t >= 80)
        return Math.hypot(q.x - upX, q.y - upY) <= 8 ? { x: q.x, y: q.y } : { x: upX, y: upY };
    }
    return { x: upX, y: upY };
  }
  // ── Loupe (imperative) ────────────────────────────────────────────────────
  function drawLoupe(pt: Pt) {
    const lc = loupeCanvasRef.current;
    const src = canvasRef.current;
    if (!lc || !src) return;
    const ctx = lc.getContext("2d");
    if (!ctx) return;
    const SIZE = 120;
    const MAG = 2.5;
    const span = SIZE / MAG / scale; // page points across the loupe
    const sx = (pt.x - span / 2) * rasterScale;
    const sy = (pt.y - span / 2) * rasterScale;
    const sw = span * rasterScale;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    try {
      ctx.drawImage(src, sx, sy, sw, sw, 0, 0, SIZE, SIZE);
    } catch {}
    ctx.strokeStyle = "#A01C2D";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
  }
  // The loupe window stays over the finger; its CONTENT and crosshair centre
  // on the lifted aim point, which is what the user is actually pointing at.
  function showLoupe(e: React.PointerEvent) {
    showLoupeAt(e.clientX, e.clientY, evtToAim(e));
  }
  function showLoupeAt(clientX: number, clientY: number, pt: Pt) {
    const host = viewportRef.current?.parentElement; // the center column (relative)
    const el = loupeElRef.current;
    if (!host || !el) return;
    const hr = host.getBoundingClientRect();
    const vx = clientX - hr.left;
    const vy = clientY - hr.top;
    el.hidden = false;
    el.style.left = `${Math.max(4, vx - LOUPE_SIZE / 2)}px`;
    // The window is centred on the aim point — the same lift liftOf() uses —
    // so what sits under the crosshair on screen IS the point that gets placed.
    el.style.top = `${vy - loupeLift(clientY) - LOUPE_SIZE / 2}px`;
    if (loupeRafRef.current == null)
      loupeRafRef.current = requestAnimationFrame(() => {
        loupeRafRef.current = null;
        drawLoupe(pt);
      });
  }
  function hideLoupe() {
    const el = loupeElRef.current;
    if (el) el.hidden = true;
  }
  // ── Rubber band while a finger aims (imperative) ──────────────────────────
  function aimLabel(pts: Pt[]): string | null {
    if (tool === "calibrate" || !currentScale?.x || !currentScale?.y) return null;
    const sx = currentScale.x;
    const sy = currentScale.y;
    if (tool === "area") return `${polyAreaSqFt(pts, sx, sy).toFixed(0)} sf`;
    if (tool === "wall")
      return `${(geomLenFeet(pts, sx, sy) * (parseFloat(wallHeight) || 0) * (wallSided === "double" ? 2 : 1)).toFixed(0)} sf`;
    if (tool === "volume")
      return `${(
        (volMode === "area" ? polyAreaSqFt(pts, sx, sy) : geomLenFeet(pts, sx, sy) * (parseFloat(volWidth) || 0)) *
        (parseFloat(volDepth) || 0)
      ).toFixed(0)} cf`;
    return `${geomLenFeet(pts, sx, sy).toFixed(1)} ft`;
  }
  function updateRubber(pt: Pt) {
    const g = rubberRef.current;
    if (!g) return;
    g.style.display = "";
    const q = (sel: string) => g.querySelector<SVGElement>(`[data-aim="${sel}"]`);
    const a = px(pt);
    const fill = tool === "area" || (tool === "volume" && volMode === "area");
    const col = tool === "calibrate" ? "#22d3ee" : color;
    // The target ring marks the lifted aim point on the sheet itself, so the
    // landing spot is readable without looking up at the loupe. It shows from
    // the very first point, before there is any rubber band to draw.
    const dot = q("dot");
    if (dot) {
      dot.setAttribute("cx", String(a.x));
      dot.setAttribute("cy", String(a.y));
      dot.setAttribute("stroke", col);
    }
    const cross = q("cross");
    if (cross) {
      cross.setAttribute(
        "d",
        `M${a.x - 11} ${a.y}H${a.x - 4}M${a.x + 4} ${a.y}H${a.x + 11}` +
          `M${a.x} ${a.y - 11}V${a.y - 4}M${a.x} ${a.y + 4}V${a.y + 11}`,
      );
      cross.setAttribute("stroke", col);
    }
    // Everything below needs at least one placed point.
    const started = draft.length > 0;
    for (const k of ["seg", "close", "fill", "label"]) {
      const el = q(k);
      if (el && !started) el.style.display = "none";
    }
    if (!started) return;
    const last = px(draft[draft.length - 1]);
    const first = px(draft[0]);
    const seg = q("seg");
    if (seg) {
      seg.style.display = "";
      seg.setAttribute("x1", String(last.x));
      seg.setAttribute("y1", String(last.y));
      seg.setAttribute("x2", String(a.x));
      seg.setAttribute("y2", String(a.y));
      seg.setAttribute("stroke", col);
    }
    const close = q("close");
    if (close) {
      if (fill && draft.length >= 2) {
        close.style.display = "";
        close.setAttribute("x1", String(a.x));
        close.setAttribute("y1", String(a.y));
        close.setAttribute("x2", String(first.x));
        close.setAttribute("y2", String(first.y));
        close.setAttribute("stroke", col);
      } else close.style.display = "none";
    }
    const poly = q("fill");
    if (poly) {
      if (fill && draft.length >= 2) {
        poly.style.display = "";
        poly.setAttribute("points", [...draft, pt].map((p) => `${px(p).x},${px(p).y}`).join(" "));
        poly.setAttribute("fill", color);
      } else poly.style.display = "none";
    }
    const label = q("label");
    if (label) {
      const t = aimLabel([...draft, pt]);
      if (t) {
        label.style.display = "";
        label.textContent = t;
        label.setAttribute("x", String(a.x + 6));
        label.setAttribute("y", String(a.y - 6));
      } else label.style.display = "none";
    }
  }
  function clearRubber() {
    const g = rubberRef.current;
    if (g) g.style.display = "none";
  }
  // Zoom so the page point under (clientX, clientY) stays put — the tap
  // fallback for pinch (double-tap in Pan mode, the +/− buttons).
  function zoomAt(clientX: number, clientY: number, next: number) {
    const vp = viewportRef.current;
    const canvas = canvasRef.current;
    if (!vp || !canvas) return;
    const crect = canvas.getBoundingClientRect();
    const vrect = vp.getBoundingClientRect();
    focusRef.current = {
      fx: crect.width ? (clientX - crect.left) / crect.width : 0.5,
      fy: crect.height ? (clientY - crect.top) / crect.height : 0.5,
      vx: clientX - vrect.left,
      vy: clientY - vrect.top,
    };
    setScale(Math.max(0.1, Math.min(6, next)));
  }

  // Place a point for the current draw tool (mouse: on press; finger: on lift).
  function placePoint(pt: Pt) {
    // starting a fresh shape clears the finalize dedupe guard
    if (draft.length === 0) finalizingRef.current = false;

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
      // "Tap the last point again = finish" — a finger gets a tight radius
      // (it has the Finish button; zoomed out, a loose one swallowed real
      // points as accidental finishes). A mouse keeps the forgiving one.
      const finishR = TOL() * (coarse ? 0.9 : 1.6);
      const nearLast = Math.hypot(last.x - pt.x, last.y - pt.y) <= finishR;
      const nearFirst = Math.hypot(first.x - pt.x, first.y - pt.y) <= TOL() * 1.6;
      const finish = (g: Pt[]) => {
        if (tool === "area") finalizeArea(g);
        else if (tool === "wall") finalizeWall(g);
        else if (tool === "volume") finalizeVolume(g);
        else finalizePolyline(g);
      };
      if (draft.length >= minPts && nearLast) {
        finish(draft);
      } else if (draft.length >= minPts && nearFirst) {
        // Back at the start: a filled shape closes by itself; an open run
        // (wall, polyline, linear volume) gets its closing segment — snapped
        // exactly onto the first point — instead of ending one short.
        finish(fillShape ? draft : [...draft, { ...first }]);
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

  // ---- pointer handling on the overlay ----
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || spaceHeld) return; // middle/right + space-pan bubble to pan
    aimLiftRef.current = liftOf(e); // edge-pan and hold-grab read this later
    const touch = e.pointerType === "touch";
    // On a finger, EVERY hit-test and grab in here uses the aim point — the
    // spot under the lens crosshair — never the contact patch. Handles,
    // midpoints, shapes: what sits under the crosshair is what you touch,
    // and what the lens magnifies is always what sits under it (Erfan,
    // 2026-09-10: "same issue with the magnifier on the other tools").
    const pt = touch ? evtToAim(e) : evtToPoint(e);

    // Finger on a draw tool: nothing is placed yet. The point goes where the
    // finger LIFTS (slide to aim with the loupe); a second finger turns the
    // gesture into a pinch instead; holding still opens the menu.
    // A second finger is navigation, whatever the tool. Without this the
    // finger that completes a pinch could grab a handle or start a crop on
    // its way down, and the pinch would edit the drawing. A touch that lands
    // while the latch is set is part of the gesture that is still finishing,
    // so it starts nothing either.
    if (touch && (gestureBlocked() || censusBlocked(censusRef.current, Date.now()))) return;
    // From here on this finger is a candidate tap; the census remembers
    // whether it was alone when it landed.
    if (touch) censusTapBegan(censusRef.current, Date.now());
    if (touch && tool !== "select" && tool !== "crop" && tool !== "browse") {
      tapRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
      aimSamplesRef.current = [];
      recordAim(e.clientX, e.clientY - aimLiftRef.current); // a still finger sends no moves: the landing spot IS the held spot
      showLoupe(e);
      updateRubber(evtToAim(e)); // show the target ring straight away
      startLongPress(e.clientX, e.clientY, e.pointerId);
      return;
    }

    if (tool === "select") {
      if (selected) {
        // A handle of the selected shape: press = maybe a drag (after 8 px),
        // maybe a tap (nudge pad), maybe a hold (vertex menu).
        const v = vertexAt(pt, true);
        if (v) {
          const vp = selected.geometry[v.index];
          const aim = evtToAim(e);
          dragRef.current = {
            id: selected.id,
            index: v.index,
            pointerId: e.pointerId,
            // A finger's handle snaps onto the crosshair and travels with it,
            // so the lens always shows the handle at its centre. A mouse
            // keeps the offset it grabbed with (the cursor IS the point).
            grab: touch ? { x: 0, y: 0 } : { x: vp.x - aim.x, y: vp.y - aim.y },
          };
          dragStartRef.current = { x: e.clientX, y: e.clientY, moved: false, hold: false };
          setEditGeom(selected.geometry.map((q) => ({ ...q })));
          try {
            svgRef.current?.setPointerCapture(e.pointerId);
          } catch {}
          if (touch) {
            showLoupeAt(e.clientX, e.clientY, aim);
            startLongPress(e.clientX, e.clientY, e.pointerId);
          }
          return;
        }
        // A "+" midpoint: add a vertex there and carry it with the finger.
        const mid = midpointAt(pt);
        if (mid) {
          const ng = [...selected.geometry.slice(0, mid.at), mid.p, ...selected.geometry.slice(mid.at)].map((q) => ({ ...q }));
          {
            const aim = evtToAim(e);
            dragRef.current = {
              id: selected.id,
              index: mid.at,
              pointerId: e.pointerId,
              grab: touch ? { x: 0, y: 0 } : { x: mid.p.x - aim.x, y: mid.p.y - aim.y },
            };
          }
          dragStartRef.current = { x: e.clientX, y: e.clientY, moved: false, hold: false, inserted: true };
          setEditGeom(ng);
          setActiveVertex({ id: selected.id, index: mid.at });
          try {
            svgRef.current?.setPointerCapture(e.pointerId);
          } catch {}
          if (touch) showLoupe(e);
          return;
        }
        // Inside a selected filled shape (or "Move" armed from the menu): drag
        // the whole shape.
        const filled =
          selected.type === "area" || (selected.type === "volume" && selected.vol_mode === "area");
        if (
          moveArmedRef.current ||
          (filled && selected.geometry.length >= 3 && pointInPoly(pt, selected.geometry))
        ) {
          moveArmedRef.current = false;
          const orig = selected.geometry.map((q) => ({ ...q }));
          moveRef.current = { id: selected.id, pointerId: e.pointerId, start: pt, orig };
          setEditGeom(orig);
          try {
            svgRef.current?.setPointerCapture(e.pointerId);
          } catch {}
          return;
        }
      }
      if (touch) {
        // Finger: select on LIFT. A stray drag does nothing (no accidental pan);
        // a hold opens the menu; a second finger makes it a pinch.
        selTapRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        startLongPress(e.clientX, e.clientY, e.pointerId);
        return;
      }
      setSelectedId(pickMeasurementAt(pt));
      return;
    }

    if (tool === "browse") return;

    // Crop: drag a rectangle (held to the chosen paper shape).
    if (tool === "crop") {
      cropDragRef.current = true;
      setCropDraft({ a: pt, b: pt });
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    placePoint(pt);
  }

  function onPointerMove(e: React.PointerEvent) {
    const touch = e.pointerType === "touch";
    // A finger aiming a point: move the loupe and the rubber-band, place later.
    if (touch && tapRef.current?.id === e.pointerId) {
      const slid =
        Math.hypot(e.clientX - tapRef.current.x, e.clientY - tapRef.current.y) > 10;
      if (slid) cancelLongPress();
      // No React state here — direct DOM updates keep this at frame rate.
      recordAim(e.clientX, e.clientY - liftOf(e));
      showLoupe(e);
      updateRubber(evtToAim(e));
      // Auto-pan ONLY once the finger is genuinely being slid, never for a
      // finger holding still. A phone screen is 375 px wide, so the edges are
      // exactly where points get placed; a stationary thumb 30 px from the
      // edge used to scroll the sheet 80 px in a third of a second, and the
      // point landed wherever the drawing had run to. Deliberately sliding
      // towards the edge to reach off-screen still pans.
      if (slid) edgePanUpdate(e.clientX, e.clientY);
      else edgePanStop();
      return;
    }
    // Select tool, finger on nothing: a slide is not a selection (and not a
    // pan — that's two fingers). It only cancels the hold.
    if (touch && selTapRef.current?.id === e.pointerId && !dragRef.current) {
      if (Math.hypot(e.clientX - selTapRef.current.x, e.clientY - selTapRef.current.y) > 10)
        cancelLongPress();
      return;
    }
    // A vertex being dragged — any tool (Select's handle, or a hold-grab).
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      const ds = dragStartRef.current;
      if (ds && !ds.moved) {
        if (Math.hypot(e.clientX - ds.x, e.clientY - ds.y) <= 8) return; // still a tap
        ds.moved = true;
        cancelLongPress();
      }
      // The handle keeps the offset it was grabbed with, so it never snaps to
      // the finger — it travels with it from wherever it was picked up.
      const aim = evtToAim(e);
      const grab = dragRef.current.grab;
      const pt = { x: aim.x + grab.x, y: aim.y + grab.y };
      // Capture the index NOW. The updater below runs later, during React's
      // next render — by then a fast lift may already have cleared dragRef,
      // and reading it there crashed the whole viewer ("null is not an
      // object (evaluating 'el.current.index')").
      const idx = dragRef.current.index;
      setEditGeom((g) => {
        if (!g) return g;
        const ng = g.map((q) => ({ ...q }));
        ng[idx] = pt;
        return ng;
      });
      if (touch) {
        // The loupe shows the handle itself, not the finger.
        showLoupeAt(e.clientX, e.clientY, pt);
        // Same rule as aiming: a handle held still near the edge must not
        // drag the whole sheet along with it. `moved` is set once the finger
        // clears the 8 px tap slop.
        if (dragStartRef.current?.moved) edgePanUpdate(e.clientX, e.clientY);
        else edgePanStop();
      }
      return;
    }
    // The whole shape being moved.
    if (moveRef.current && moveRef.current.pointerId === e.pointerId) {
      const pt = touch ? evtToAim(e) : evtToPoint(e); // same frame the grab used
      const { start, orig } = moveRef.current;
      const dx = pt.x - start.x;
      const dy = pt.y - start.y;
      setEditGeom(orig.map((q) => ({ x: q.x + dx, y: q.y + dy })));
      return;
    }
    if (tool === "crop") {
      if (!cropDragRef.current) return;
      const pt = evtToPoint(e);
      setCropDraft((d) => (d ? { a: d.a, b: constrainCrop(d.a, pt) } : d));
      return;
    }
    // `hover` is the MOUSE preview (the dashed next segment that follows the
    // cursor). A finger never sets it: a finger's preview is the imperative
    // rubber band above, which the census clears the moment a second finger
    // lands. Before this guard, a finger whose tap the census had cancelled
    // kept sending moves that fell through to here, and the dashed shape
    // followed it to wherever it last was — and stayed there after the
    // lift, because nothing clears the mouse hover on a touch. That was the
    // "random point" still drawn after the sixth fix (2026-09-10, 7:29 am).
    if (touch || tool === "select" || tool === "browse" || draft.length === 0) return;
    setHover(evtToPoint(e));
  }

  function onDoubleClick(e?: React.MouseEvent) {
    // Select tool: double-click a shape = its menu (same as right-click).
    if (tool === "select" && e) {
      const id = pickMeasurementAt(evtToPoint(e as unknown as React.PointerEvent));
      if (id) {
        setSelectedId(id);
        setMenu({ x: e.clientX, y: e.clientY, kind: "measurement", id });
      }
      return;
    }
    if (tool === "polyline" && draft.length >= 2) finalizePolyline(draft);
    else if (tool === "area" && draft.length >= 3) finalizeArea(draft);
    else if (tool === "wall" && draft.length >= 2) finalizeWall(draft);
    else if (tool === "volume") {
      if (draft.length >= (volMode === "area" ? 3 : 2)) finalizeVolume(draft);
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      if (tapRef.current?.id === e.pointerId) {
        const fired = longPressFiredRef.current;
        const held = stableAimPoint(e.clientX, e.clientY - liftOf(e));
        const pt = clientToPoint(held.x, held.y);
        cancelTouchTap();
        // A long-press opened the menu, or this touch was part of a pinch, or
        // the zoom it committed has not landed yet: no point.
        if (fired || pinchedRef.current || placementBlocked()) return;
        // The authority: was this finger alone from touch to lift, with no
        // pinch cool-down running? If not, nothing is placed — whatever the
        // pointer-event bookkeeping above thought it saw.
        if (!censusMayPlace(censusRef.current, Date.now())) return;
        placePoint(pt);
        return;
      }
      // Select tool: the tap lands now (unless it became a hold / pinch / slide).
      if (selTapRef.current?.id === e.pointerId && !dragRef.current) {
        const st = selTapRef.current;
        selTapRef.current = null;
        const fired = longPressFiredRef.current;
        cancelLongPress();
        hideLoupe();
        if (fired || pinchedRef.current) return;
        if (!censusMayPlace(censusRef.current, Date.now())) return;
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) return;
        const id = pickMeasurementAt(evtToAim(e)); // a finger selects what is under the crosshair
        setSelectedId(id);
        // Double-tap on the same shape = its menu.
        const now = Date.now();
        const lt = lastSelTapRef.current;
        if (id && lt && lt.id === id && now - lt.t < 300 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 24) {
          lastSelTapRef.current = null;
          setMenu({ x: e.clientX, y: e.clientY, kind: "measurement", id });
          return;
        }
        lastSelTapRef.current = id ? { x: e.clientX, y: e.clientY, t: now, id } : null;
        return;
      }
      selTapRef.current = null;
      cancelLongPress();
    }
    if (tool === "crop") {
      cropDragRef.current = false;
      // A click without a drag is not a crop.
      setCropDraft((d) =>
        d && Math.abs(d.b.x - d.a.x) > 4 && Math.abs(d.b.y - d.a.y) > 4 ? d : null,
      );
      return;
    }
    // A handle press ends: a drag commits; a tap makes it the active vertex
    // (nudge pad); a hold that never slid opens the vertex menu.
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      const { id, index } = dragRef.current;
      const ds = dragStartRef.current;
      dragRef.current = null;
      dragStartRef.current = null;
      hideLoupe();
      edgePanStop();
      if (!ds?.moved && !ds?.inserted) {
        setEditGeom(null);
        setActiveVertex({ id, index });
        if (ds?.hold) setMenu({ x: e.clientX, y: e.clientY, kind: "vertex", id, index });
        return;
      }
      const geometry = editGeom;
      setEditGeom(null);
      if (geometry) await commitGeometry(id, geometry);
      return;
    }
    if (moveRef.current && moveRef.current.pointerId === e.pointerId) {
      const { id } = moveRef.current;
      moveRef.current = null;
      const geometry = editGeom;
      setEditGeom(null);
      if (geometry) await commitGeometry(id, geometry);
    }
  }

  // ---- edit / copy / delete ----
  async function updateSelected(patch: Partial<Pick<Measurement, "layer" | "color">>) {
    if (!selected) return;
    recordHistory();
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
    recordHistory();
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
    recordHistory();
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
    recordHistory();
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
    recordHistory();
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
    recordHistory();
    const ids = rows.map((r) => r.id);
    const layerVal = newName.trim() || null;
    setMeasurements((arr) =>
      arr.map((m) => (ids.includes(m.id) ? { ...m, layer: layerVal } : m)),
    );
    await supabase.from("measurements").update({ layer: layerVal }).in("id", ids);
  }

  async function recolorLayer(rows: Measurement[], newColor: string) {
    recordHistory();
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
    recordHistory();
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
    recordHistory();
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
    recordHistory();
    await supabase.from("measurements").delete().eq("id", id);
    setMeasurements((m) => m.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // ── Undo / redo engine ────────────────────────────────────────────────────
  // Snapshot the current measurements before a change. Capped to 50 steps.
  function recordHistory() {
    setUndoStack((s) => [...s.slice(-49), measurements]);
    setRedoStack([]);
  }

  // Make the DB match `target`, knowing `current` is what's stored now.
  async function reconcileDb(target: Measurement[], current: Measurement[]) {
    const tgt = new Map(target.map((m) => [m.id, m]));
    const cur = new Map(current.map((m) => [m.id, m]));
    // Placeholders (saves still in flight) have no row yet: the save itself
    // notices if it was undone meanwhile and removes its row.
    const toDelete = current.filter((m) => !tgt.has(m.id) && !isTemp(m.id)).map((m) => m.id);
    const toInsert = target.filter((m) => !cur.has(m.id) && !isTemp(m.id));
    const toUpdate = target.filter((m) => {
      if (isTemp(m.id)) return false;
      const c = cur.get(m.id);
      return c && JSON.stringify(c) !== JSON.stringify(m);
    });
    if (toDelete.length)
      await supabase.from("measurements").delete().in("id", toDelete);
    if (toInsert.length && currentSheet) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("measurements").insert(
          toInsert.map((m) => ({
            id: m.id,
            project_id: projectId,
            plan_file_id: planFile.id,
            sheet_id: currentSheet.id,
            owner_id: user.id,
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
            text: m.text,
            font_size: m.font_size,
            head_size: m.head_size,
          })),
        );
      }
    }
    for (let i = 0; i < toUpdate.length; i += 10) {
      await Promise.all(
        toUpdate.slice(i, i + 10).map((m) =>
          supabase
            .from("measurements")
            .update({
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
              text: m.text,
              font_size: m.font_size,
              head_size: m.head_size,
            })
            .eq("id", m.id),
        ),
      );
    }
  }

  async function applyHistory(target: Measurement[], pushTo: "undo" | "redo") {
    const current = measurements;
    if (pushTo === "redo") setRedoStack((s) => [...s.slice(-49), current]);
    else setUndoStack((s) => [...s.slice(-49), current]);
    finishCount();
    setSelectedId(null);
    setEditGeom(null);
    setDraft([]);
    setMeasurements(target);
    try {
      await reconcileDb(target, current);
    } finally {
      historyBusy.current = false;
    }
  }

  async function undo() {
    if (historyBusy.current || !undoStack.length) return;
    historyBusy.current = true;
    const target = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    await applyHistory(target, "redo");
  }

  async function redo() {
    if (historyBusy.current || !redoStack.length) return;
    historyBusy.current = true;
    const target = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    await applyHistory(target, "undo");
  }

  // ---- pan + touch gestures ----
  // Mouse: right/middle drag (or Space) pans; the wheel zooms. Finger: ONE
  // finger draws (or pans in Pan mode); TWO fingers pinch-zoom and pan in ANY
  // tool. Touch pointers are implicitly captured by the element they started
  // on and bubble here, so the viewport sees every finger without capturing.
  function midAndDist(): { mx: number; my: number; d: number } | null {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  function onPanDown(e: React.PointerEvent) {
    const vp = viewportRef.current;
    if (!vp) return;
    if (e.pointerType === "touch") {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        // Second finger: whatever the first was doing becomes a pinch.
        const g = midAndDist()!;
        const crect = canvasRef.current?.getBoundingClientRect();
        pinchRef.current = {
          dist0: Math.max(g.d, 1),
          scale0: scale,
          fx: crect && crect.width ? (g.mx - crect.left) / crect.width : 0.5,
          fy: crect && crect.height ? (g.my - crect.top) / crect.height : 0.5,
        };
        pinchedRef.current = true;
        panRef.current = null;
        cancelTouchTap();
        // Live preview: scale/move the page with a transform until lift.
        pinchLiveRef.current = { k: 1, mx: g.mx, my: g.my, dx: 0, dy: 0 };
        const wrap = pageWrapRef.current;
        if (wrap) {
          wrap.style.transformOrigin = `${pinchRef.current.fx * 100}% ${pinchRef.current.fy * 100}%`;
          wrap.style.willChange = "transform";
        }
        // Whatever the first finger had started is abandoned, untouched: a
        // vertex snaps back, a shape move is dropped, a crop box vanishes.
        dragRef.current = null;
        dragStartRef.current = null;
        moveRef.current = null;
        selTapRef.current = null;
        setEditGeom(null);
        cropDragRef.current = false;
        setCropDraft(null);
        return;
      }
      if (pointersRef.current.size > 2) return;
      pinchedRef.current = false;
      if (tool === "browse" || spaceHeld) {
        // Double-tap = zoom in here (the tap fallback for pinch).
        const last = lastTapRef.current;
        const now = Date.now();
        if (last && now - last.t < 300 && Math.hypot(last.x - e.clientX, last.y - e.clientY) < 24) {
          lastTapRef.current = null;
          zoomAt(e.clientX, e.clientY, scale * 2);
          return;
        }
        lastTapRef.current = { x: e.clientX, y: e.clientY, t: now };
        panRef.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      }
      return;
    }
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
    if (!vp) return;
    if (e.pointerType === "touch") {
      if (pointersRef.current.has(e.pointerId))
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinchRef.current;
      const g = midAndDist();
      const live = pinchLiveRef.current;
      if (p && g && live) {
        // Preview only: one transform per move, nothing re-renders. Scale is
        // clamped to the real zoom range; the midpoint drag becomes a pan.
        const k = Math.max(0.1 / p.scale0, Math.min(6 / p.scale0, g.d / p.dist0));
        live.k = k;
        live.dx = g.mx - live.mx;
        live.dy = g.my - live.my;
        const wrap = pageWrapRef.current;
        if (wrap) wrap.style.transform = `translate(${live.dx}px, ${live.dy}px) scale(${k})`;
        return;
      }
    }
    if (!panRef.current) return;
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
    if (e.pointerType === "touch") {
      // Pan tool: a plain tap on a shape selects it (and switches to Select).
      if (
        tool === "browse" &&
        panRef.current &&
        pointersRef.current.size === 1 &&
        !pinchedRef.current &&
        Math.hypot(e.clientX - panRef.current.x, e.clientY - panRef.current.y) < 10 &&
        svgRef.current
      ) {
        const rect = svgRef.current.getBoundingClientRect();
        const id = pickMeasurementAt({
          x: (e.clientX - rect.left) / scale,
          y: (e.clientY - rect.top) / scale,
        });
        if (id) {
          lastTapRef.current = null;
          setTool("select");
          setSelectedId(id);
        }
      }
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2 && pinchRef.current) {
        // Pinch over: drop the preview transform and commit the real zoom,
        // keeping the page point that was under the fingers where they left it.
        const p = pinchRef.current;
        const live = pinchLiveRef.current;
        pinchRef.current = null;
        pinchLiveRef.current = null;
        const wrap = pageWrapRef.current;
        const canvas = canvasRef.current;
        if (live && wrap && vp && canvas) {
          wrap.style.transform = "";
          wrap.style.willChange = "";
          const vrect = vp.getBoundingClientRect();
          const vx = live.mx + live.dx - vrect.left;
          const vy = live.my + live.dy - vrect.top;
          const final = Math.max(0.1, Math.min(6, p.scale0 * live.k));
          if (Math.abs(final - scale) / scale > 0.002) {
            focusRef.current = { fx: p.fx, fy: p.fy, vx, vy };
            // Until this lands, the SVG's rect and `scale` disagree — see
            // the gate's zoomSettling. Nothing may be placed in that window.
            gateRef.current.zoomSettling = true;
            setScale(final);
          } else {
            const crect = canvas.getBoundingClientRect();
            const originX = crect.left - vrect.left + vp.scrollLeft;
            const originY = crect.top - vrect.top + vp.scrollTop;
            vp.scrollLeft = originX + p.fx * crect.width - vx;
            vp.scrollTop = originY + p.fy * crect.height - vy;
          }
        }
      }
      if (pointersRef.current.size === 0) panRef.current = null;
      return;
    }
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
    const m = await supabase.from("measurements").delete().eq("sheet_id", id);
    const s = m.error ? m : await supabase.from("sheets").delete().eq("id", id);
    if (s.error) {
      // Say so — a silent failure looks like "the button does nothing".
      window.alert(`Could not delete the sheet: ${s.error.message}`);
      return;
    }
    setRemovedSheetIds((prev) => new Set(prev).add(id)); // drop it from the list now
    if (activeSheetId === id) setActiveSheetId(null);
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

  // On-drawing labels: ONE per layer, showing the layer's consolidated total,
  // anchored on the layer's largest run — not a number on every run, which
  // buried the sheet. The selected run keeps its own label while it's being
  // edited. Greedy collision avoidance nudges overlapping labels down.
  const LABEL_FONT = 14;
  const labelLayout: Record<string, { x: number; y: number; text: string }> = {};
  // Areas additionally get their own value written across the middle of the
  // shape — a room's square footage belongs inside the room. These are laid
  // out first so the layer totals dodge them rather than landing on top.
  const areaLabels: { id: string; x: number; y: number; text: string }[] = [];
  {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const lineH = LABEL_FONT + 4;
    const geomOf = (m: Measurement) =>
      m.id === selectedId && editGeom ? editGeom : m.geometry;
    const isCentered = (m: Measurement) =>
      m.type === "area" ||
      m.type === "count" ||
      (m.type === "volume" && m.vol_mode === "area");
    // The subset that gets its own label drawn inside the shape. Counts are
    // centred too, but they're scattered tally marks with no interior to
    // write in, so they keep the layer label instead.
    const hasOwnAreaLabel = (m: Measurement) =>
      (m.type === "area" || (m.type === "volume" && m.vol_mode === "area")) &&
      geomOf(m).length >= 3;
    const anchorOf = (m: Measurement): Pt | null => {
      const geom = geomOf(m);
      if (geom.length === 0) return null;
      return isCentered(m)
        ? polyCentroid(geom)
        : geom.length >= 2
          ? { x: (geom[0].x + geom[1].x) / 2, y: (geom[0].y + geom[1].y) / 2 }
          : geom[0];
    };
    for (const m of measurements) {
      if (m.type !== "area" && !(m.type === "volume" && m.vol_mode === "area")) continue;
      if (m.value == null || hiddenLayers.has(layerKeyOf(m.layer))) continue;
      const geom = geomOf(m);
      if (geom.length < 3) continue;
      const text = labelText(m);
      if (!text) continue;
      const c = px(polyCentroid(geom));
      areaLabels.push({ id: m.id, x: c.x, y: c.y, text });
      // Centred text, so the reserved box straddles the anchor.
      const w = text.length * LABEL_FONT * 0.6 + 6;
      placed.push({ x: c.x - w / 2, y: c.y + lineH / 2, w, h: lineH });
    }
    const place = (key: string, anchor: Pt, text: string) => {
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
      labelLayout[key] = { x, y, text };
    };
    const byLayer = new Map<string, Measurement[]>();
    for (const m of measurements) {
      if (m.type === "leader" || m.value == null) continue;
      const key = layerKeyOf(m.layer);
      if (hiddenLayers.has(key)) continue;
      const list = byLayer.get(key);
      if (list) list.push(m);
      else byLayer.set(key, [m]);
    }
    for (const [key, rows] of byLayer) {
      const totals: Record<string, number> = {};
      for (const m of rows) totals[m.unit || ""] = (totals[m.unit || ""] ?? 0) + (m.value ?? 0);
      const parts = Object.entries(totals).map(([unit, sum]) =>
        unit === "cf" ? `${sum.toFixed(0)} cf` : unit === "ea" ? `${sum}` : `${sum.toFixed(1)} ${unit}`,
      );
      const biggest = rows.reduce((a, b) => (Math.abs(b.value ?? 0) > Math.abs(a.value ?? 0) ? b : a));
      const anchor = anchorOf(biggest);
      if (!anchor) continue;
      place(`layer:${key}`, anchor, key === "Unlabeled" ? parts.join(" · ") : `${key}: ${parts.join(" · ")}`);
    }
    // The run being edited shows its own number too — unless it's an area,
    // which already carries its value in the middle of the shape.
    if (selected && selected.type !== "leader" && !hasOwnAreaLabel(selected)) {
      const t = labelText(selected);
      const a = anchorOf(selected);
      if (t && a) place(selected.id, a, t);
    }
  }
  const layerLabels = Object.entries(labelLayout).filter(([k]) => k.startsWith("layer:"));

  // Order matters on a phone: the tools row scrolls sideways, so the ones used
  // most sit first and stay visible.
  const TOOLS: { id: Tool; label: string; icon: (p: ToolIconProps) => React.ReactElement }[] = [
    { id: "select", label: "Select", icon: SelectIcon },
    { id: "browse", label: "Pan", icon: PanIcon },
    { id: "line", label: "Line", icon: LineIcon },
    { id: "area", label: "Area", icon: AreaIcon },
    { id: "count", label: "Count", icon: CountIcon },
    { id: "polyline", label: "Polyline", icon: PolylineIcon },
    { id: "wall", label: "Wall", icon: WallIcon },
    { id: "volume", label: "Volume", icon: VolumeIcon },
    { id: "leader", label: "Leader", icon: LeaderIcon },
    { id: "calibrate", label: "Calibrate", icon: CalibrateIcon },
    { id: "crop", label: "Crop", icon: CropIcon },
  ];

  // The scale preset picker — in the phone's top row and the desktop toolbar.
  const scaleSelect = (cls: string) => (
    <select
      value={currentScale?.preset ?? ""}
      onChange={(e) => applyPreset(e.target.value)}
      aria-label="Sheet scale"
      className={`rounded-md border border-border bg-background px-2 py-1 text-foreground focus:border-brand focus:outline-none ${cls}`}
    >
      <option value="">{hasScale && !currentScale?.preset ? "Manual" : "Not set"}</option>
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
  );

  // Running totals for this sheet, grouped by layer and summed per unit.
  // One group per layer: rows + summed totals. The panel shows these groups
  // (Bluebeam-style) instead of a flat record list — the group IS the takeoff
  // line; its rows are the individual runs you drew.
  // Memoized: this walks every measurement, and it used to re-run on each
  // keystroke in the layer field and on every drag frame.
  const layerGroups = useMemo(() => buildLayerGroups(measurements), [measurements]);
  // Just the names, for the layer field's "continuing / new" hint.
  const layerNames = useMemo(() => layerGroups.map((g) => g.layer), [layerGroups]);

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
                  {
                    label: "Move",
                    onClick: () => {
                      // The next drag (anywhere) carries the whole shape.
                      setTool("select");
                      setSelectedId(m.id);
                      moveArmedRef.current = true;
                    },
                  },
                  { label: "Duplicate", onClick: () => duplicateMeasurement(m) },
                  {
                    label: "Properties",
                    onClick: () => {
                      setTool("select");
                      setSelectedId(m.id);
                      setPanelOpen(true);
                    },
                  },
                  {
                    label: "Delete",
                    danger: true,
                    onClick: () => deleteMeasurement(m.id),
                  },
                ]
              : [];
          })()
        : menu.kind === "vertex"
          ? (() => {
              const m = measurements.find((x) => x.id === menu.id);
              const i = menu.index ?? 0;
              if (!m) return [];
              // No Nudge on a phone — the pad is gone there; a handle is
              // adjusted by dragging it with the lens.
              const items: { label: string; danger?: boolean; onClick: () => void }[] = coarse
                ? []
                : [
                    {
                      label: "Nudge",
                      onClick: () => {
                        setTool("select");
                        setSelectedId(m.id);
                        setActiveVertex({ id: m.id, index: i });
                      },
                    },
                  ];
              if (m.type !== "count" && m.type !== "leader" && m.type !== "line")
                items.push({ label: "Split segment here", onClick: () => splitAfterVertex(m.id, i) });
              if (m.geometry.length > minPointsOf(m) || m.type === "count")
                items.push({
                  label: m.type === "count" ? "Delete this marker" : "Delete this point",
                  danger: true,
                  onClick: () => deleteVertex(m.id, i),
                });
              return items;
            })()
        : menu.kind === "sheet"
          ? (() => {
              const s = sheetList.find((x) => x.id === menu.id);
              return s
                ? [
                    { label: "Open", onClick: () => openSheet(s) },
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
          {/* G1 - on a phone the sheet list behaves exactly like the layers
              panel: a bottom sheet you can dismiss by tapping the drawing
              behind it, not a full-screen takeover with no way out but the
              toolbar button. Same scrim, same height cap, same corners. */}
          {phone ? (
            <div
              className="fixed inset-0 z-30 bg-background/60"
              aria-hidden
              onPointerDown={() => setNavOpen(false)}
            />
          ) : null}
          <aside
            className={
              phone
                ? "glass-strong pb-safe fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-t-2xl"
                : "glass z-10 flex shrink-0 flex-col"
            }
            style={phone ? undefined : { width: navW }}
          >
            <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-3">
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
                {/* Categorizing happens here (only here). Uncategorized sheets
                    are still read — by EVERY AI pass — so this is a cost nudge. */}
                {(() => {
                  const n = sheetList.filter(
                    (s) => !(disciplines[s.id] ?? "").trim(),
                  ).length;
                  return n > 0 ? (
                    <p className="mt-0.5 text-[11px] text-amber-300/90">
                      {n} sheet{n > 1 ? "s" : ""} to categorize — routes the AI to the right sheets
                    </p>
                  ) : null;
                })()}
              </div>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                title="Hide sheets"
                className="shrink-0 rounded-md border border-border px-2 py-1 text-muted transition-colors hover:border-brand hover:text-foreground"
              >
                «
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sheetList.map((s) => {
                const active = s.id === currentSheet?.id;
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
                    // Long-press (finger held ~0.5 s) = the same menu as right-click.
                    onPointerDown={(e) => {
                      if (e.pointerType !== "touch") return;
                      const { clientX: x, clientY: y } = e;
                      if (rowPressRef.current) clearTimeout(rowPressRef.current);
                      rowPressRef.current = setTimeout(
                        () => setMenu({ x, y, kind: "sheet", id: s.id }),
                        450,
                      );
                    }}
                    onPointerUp={() => {
                      if (rowPressRef.current) clearTimeout(rowPressRef.current);
                    }}
                    onPointerMove={() => {
                      if (rowPressRef.current) clearTimeout(rowPressRef.current);
                    }}
                    onPointerCancel={() => {
                      if (rowPressRef.current) clearTimeout(rowPressRef.current);
                    }}
                    className={`rounded-lg text-sm transition-colors ${s.crop ? "ml-3" : ""} ${
                      active
                        ? "glass-brand text-foreground"
                        : "text-muted hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    <div className="group flex items-center gap-1 px-2 py-1.5">
                      {s.crop ? (
                        <span
                          className="shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wider text-muted"
                          title="Cropped from this page — the original is untouched"
                        >
                          crop
                        </span>
                      ) : null}
                      {editing ? (
                        <input
                          autoFocus
                          spellCheck
                          aria-label="Sheet name"
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
                            onClick={() => openSheet(s)}
                            onDoubleClick={() => setEditingSheetId(s.id)}
                            title="Click to open · double-click to rename"
                            className="min-w-0 flex-1 truncate text-left"
                          >
                            {sheetTitle(s)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSheetId(s.id)}
                            title="Rename"
                            className="shrink-0 rounded px-1 text-xs text-muted opacity-0 transition hover:text-brand-soft group-hover:opacity-100 pointer-coarse:opacity-100"
                          >
                            ✎
                          </button>
                        </>
                      )}
                    </div>
                    {!editing ? (
                      <div className="px-2 pb-1.5">
                        <select
                          value={disciplines[s.id] ?? ""}
                          onChange={(e) => onPickDiscipline(s.id, e.target.value)}
                          title="Sheet category (helps the AI read the right sheets)"
                          className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted focus:border-brand focus:outline-none"
                        >
                          <option value="">Uncategorized</option>
                          {DISCIPLINE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                          {customCategories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          <option value="__add__">＋ Add category…</option>
                        </select>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </aside>
          {/* Drag-to-resize is a desktop affordance; a bottom sheet has no
              edge to drag. */}
          {phone ? null : (
            <div
              className="resize-handle z-10"
              onPointerDown={(e) => startResize("left", e)}
            />
          )}
        </>
      ) : null}

      {/* Center */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        // Finger census for the whole column (capture phase, so overlays
        // count too): see the touch gate.
        // Only presses physically inside this column count. React also routes
        // a portal's events (the phone bottom sheets) through here; a finger on
        // a sheet's backdrop must not register as a finger on the drawing.
        onPointerDownCapture={(e) => {
          if (e.pointerType === "touch" && e.currentTarget.contains(e.target as Node)) fingerDown(e.pointerId);
        }}
        onPointerUpCapture={(e) => {
          if (e.pointerType === "touch") fingerUp(e.pointerId);
        }}
        onPointerCancelCapture={(e) => {
          if (e.pointerType === "touch") fingerUp(e.pointerId);
        }}
      >
        {/* Toolbar. Phone (below md): row 1 = sheets · undo/redo · scale · More;
            row 2 = every tool as a 6-column grid of 44 px icon buttons, none
            hidden off the edge. Zoom, legend, export and the panels sit in the
            More sheet. md and up: one wrapping row, icons with labels. */}
        <div className="glass-strong z-10 flex flex-col gap-1.5 px-2 py-1.5 text-sm md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-3 md:px-4 md:py-2.5">
          <div className="flex items-center gap-1.5 text-muted md:gap-2">
            {!navOpen ? (
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                title="Show sheets"
                className="rounded-md border border-border px-2.5 py-1 text-foreground hover:border-brand"
              >
                » Sheets
              </button>
            ) : null}
            <button
              type="button"
              onClick={undo}
              disabled={!undoStack.length}
              title="Undo (Ctrl+Z)"
              className="rounded-md border border-border px-2 py-1 text-foreground hover:border-brand disabled:opacity-40"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!redoStack.length}
              title="Redo (Ctrl+Shift+Z)"
              className="rounded-md border border-border px-2 py-1 text-foreground hover:border-brand disabled:opacity-40"
            >
              ↷
            </button>
            {/* Phone: the scale and the More sheet share row 1 */}
            <label className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
              <span className="text-[10px] uppercase tracking-wider">Scale</span>
              {scaleSelect("min-w-0 flex-1 text-xs")}
            </label>
            {/* Phone: the measurements panel is one tap away (it opens as a
                bottom sheet; tapping the drawing closes it). */}
            <button
              type="button"
              onClick={() => setPanelOpen((o) => !o)}
              aria-pressed={panelOpen}
              aria-label={panelOpen ? "Hide measurements" : "Show measurements"}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-foreground sm:hidden ${
                panelOpen ? "border-brand bg-brand/15" : "border-border hover:border-brand"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
              </svg>
              {measurements.length ? (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] leading-4 text-white">
                  {measurements.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="More viewer controls"
              aria-haspopup="dialog"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-foreground hover:border-brand md:hidden"
            >
              <MoreIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Tools: a 6-column grid on phones (two rows, all visible); a row
              of icon + label buttons from md up. */}
          <div className="grid grid-cols-6 gap-1 md:flex md:min-w-0 md:max-w-full md:flex-wrap md:items-center">
            {TOOLS.map((t) => {
              const Ico = t.icon;
              const active = tool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTool(t.id)}
                  aria-pressed={active}
                  title={t.label}
                  className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border px-1 text-[10px] leading-none transition-colors md:min-h-0 md:shrink-0 md:flex-row md:gap-1.5 md:whitespace-nowrap md:px-2.5 md:py-1 md:text-xs ${
                    active
                      ? "border-brand bg-brand/15 text-foreground"
                      : "border-border text-muted hover:border-brand"
                  }`}
                >
                  <Ico className="h-5 w-5 md:h-4 md:w-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="hidden items-center gap-3 text-muted md:flex">
            <label className="flex items-center gap-1.5">
              <span className="text-xs uppercase tracking-wider">Scale</span>
              {scaleSelect("")}
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
            {!panelOpen ? (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                title="Show measurements"
                className="rounded-md border border-border px-2.5 py-1 text-foreground hover:border-brand"
              >
                « Panel
              </button>
            ) : null}
          </div>
        </div>

        {/* Phone "More" sheet: zoom, legend, export, panels */}
        {moreOpen ? (
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 md:hidden"
            onClick={() => setMoreOpen(false)}
          >
            <div
              role="dialog"
              aria-label="Viewer controls"
              className="glass-strong pb-safe w-full max-w-sm rounded-t-2xl p-3 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted">Zoom</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setScale((s) => Math.max(0.1, s / 1.25))}
                    aria-label="Zoom out"
                    className="h-11 w-11 rounded-md border border-border text-lg text-foreground"
                  >
                    −
                  </button>
                  <span className="w-14 text-center tabular-nums text-foreground">{Math.round(scale * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setScale((s) => Math.min(6, s * 1.25))}
                    aria-label="Zoom in"
                    className="h-11 w-11 rounded-md border border-border text-lg text-foreground"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={fitWidth}
                    className="h-11 rounded-md border border-border px-3 text-foreground"
                  >
                    Fit
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1">
                {ledgerRows.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateLedger({ visible: !currentLedger?.visible });
                      setMoreOpen(false);
                    }}
                    className="flex min-h-12 items-center rounded-lg px-3 text-left text-foreground hover:bg-foreground/10"
                  >
                    {currentLedger?.visible ? "Hide legend" : "Show legend"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    openExport();
                  }}
                  disabled={status !== "ready"}
                  className="flex min-h-12 items-center rounded-lg px-3 text-left text-foreground hover:bg-foreground/10 disabled:opacity-40"
                >
                  Export marked-up PDF…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPanelOpen((o) => !o);
                    setMoreOpen(false);
                  }}
                  className="flex min-h-12 items-center rounded-lg px-3 text-left text-foreground hover:bg-foreground/10"
                >
                  {panelOpen ? "Hide measurements panel" : "Show measurements panel"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNavOpen((o) => !o);
                    setMoreOpen(false);
                  }}
                  className="flex min-h-12 items-center rounded-lg px-3 text-left text-foreground hover:bg-foreground/10"
                >
                  {navOpen ? "Hide sheet list" : "Show sheet list"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="mt-1 flex min-h-11 w-full items-center justify-center rounded-lg border-t border-border text-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
        ) : null}

        {/* New-measurement attributes (Line / Polyline / Area / Wall / Volume / Count).
            One short row: the layer name takes the width; on phones the color is
            a single swatch that opens a popover of 44 px swatches (twelve
            inline dots each stretched to 44 px by the touch rule was what made
            this bar so tall). */}
        {tool === "line" ||
        tool === "polyline" ||
        tool === "area" ||
        tool === "wall" ||
        tool === "volume" ||
        tool === "count" ? (
          <div className="glass z-10 flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-xs md:gap-3 md:px-4 md:py-2 md:text-sm">
            {/* Layer picker: the layer new runs record into. One tap shows
                every layer on this sheet (continue one) or a field for a new
                name. Sticks across tool switches. */}
            <div className="relative flex min-w-0 flex-1 basis-40 items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted md:text-xs">Layer</span>
              <button
                type="button"
                onClick={(e) => {
                  layerAnchorRef.current = e.currentTarget.getBoundingClientRect();
                  setLayerOpen((o) => !o);
                }}
                aria-haspopup="listbox"
                aria-expanded={layerOpen}
                title="The layer new runs are added to"
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-left text-foreground hover:border-brand md:min-h-0 md:w-56 md:flex-none"
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                <span className={`min-w-0 flex-1 truncate ${layer.trim() ? "" : "text-muted/70"}`}>
                  {layer.trim() ||
                    (layerGroups.some((g) => g.layer === "Unlabeled") ? "Unlabeled" : "New layer…")}
                </span>
                {layerGroups.some((g) => g.layer === layerKeyOf(layer)) ? (
                  <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" title="Recording into this layer" />
                ) : null}
                <span className="text-muted" aria-hidden>▾</span>
              </button>
              {layerOpen
                ? popover(
                    () => setLayerOpen(false),
                    <div className="p-1.5 text-sm">
                      <LayerNameField
                        initial={layer}
                        existing={layerNames}
                        skipCommitRef={skipLayerCommitRef}
                        onCommit={setLayer}
                        onDone={() => setLayerOpen(false)}
                      />
                      {layerGroups.length ? (
                        <>
                          <p className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-muted">
                            Continue a layer
                          </p>
                          <div className="max-h-[32vh] overflow-y-auto sm:max-h-56">
                            {layerGroups.map((g) => {
                              const active = layerKeyOf(layer) === g.layer;
                              return (
                                <button
                                  key={g.layer}
                                  type="button"
                                  onClick={() => {
                                    // The name field's closing commit must not
                                    // overwrite the layer just picked.
                                    skipLayerCommitRef.current = true;
                                    continueLayer(g);
                                    const kind = g.rows[0]?.type as Tool | undefined;
                                    if (!MEASURE_TOOLS.includes(tool) && kind && MEASURE_TOOLS.includes(kind)) setTool(kind);
                                    setLayerOpen(false);
                                  }}
                                  className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-foreground hover:bg-foreground/10 ${
                                    active ? "bg-brand/15" : ""
                                  }`}
                                >
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
                                  <span className="min-w-0 flex-1 truncate">{g.layer}</span>
                                  <span className="shrink-0 text-[10px] text-muted">
                                    {g.lines.length ? g.lines.join(" · ") : `${g.rows.length}`}
                                  </span>
                                  {/* Rename an existing layer (all its runs) in the panel editor */}
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Rename ${g.layer}`}
                                    title="Rename this layer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLayerOpen(false);
                                      setPanelOpen(true);
                                      openLayerEditor(g);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setLayerOpen(false);
                                        setPanelOpen(true);
                                        openLayerEditor(g);
                                      }
                                    }}
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-foreground/10 hover:text-foreground"
                                  >
                                    ✎
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : null}
                    </div>,
                    "w-72",
                    layerAnchorRef.current,
                  )
                : null}
            </div>
            <div className="relative flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted md:text-xs">Color</span>
              {/* Phone: one swatch → popover */}
              <button
                type="button"
                onClick={() => setColorOpen((o) => !o)}
                aria-label="Pick a color"
                aria-haspopup="true"
                aria-expanded={colorOpen}
                className="flex h-10 w-10 min-h-0 items-center justify-center rounded-md border border-border md:hidden"
              >
                <span className="h-5 w-5 rounded-full" style={{ background: color }} />
              </button>
              {/* md+: the dots inline */}
              <div className="hidden items-center gap-1 md:flex">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                    style={{ background: c }}
                    className={`h-5 w-5 min-h-0 rounded-full ${color === c ? "ring-2 ring-foreground" : ""}`}
                  />
                ))}
              </div>
              {colorOpen ? (
                <>
                  <div className="fixed inset-0 z-20 md:hidden" onClick={() => setColorOpen(false)} />
                  <div className="glass-strong absolute right-0 top-full z-30 mt-1 grid grid-cols-6 gap-0.5 rounded-xl p-1.5 md:hidden" data-popover="color">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setColor(c);
                          setColorOpen(false);
                        }}
                        aria-label={`Color ${c}`}
                        aria-pressed={color === c}
                        className="flex h-11 w-11 min-h-0 items-center justify-center rounded-lg hover:bg-foreground/10"
                      >
                        <span
                          className={`h-6 w-6 rounded-full ${color === c ? "ring-2 ring-foreground" : ""}`}
                          style={{ background: c }}
                        />
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
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
                    : coarse
                      ? "Tap each item — every tap saves · hold a marker to remove it"
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
              <span className="basis-full text-brand-soft md:basis-auto md:text-xs">
                Set a scale before measuring.
              </span>
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
          onPointerCancel={onPanEnd}
          // A finger sliding past the edge is NOT the end of its gesture (a
          // pinch near the toolbar would otherwise drop a finger); only the
          // mouse leaving matters.
          onPointerLeave={(e) => {
            if (e.pointerType !== "touch") onPanEnd(e);
          }}
          onContextMenu={onCanvasContextMenu}
          className="touch-surface relative min-h-0 flex-1 overflow-auto bg-background/70"
          // touch-action none: the browser hands us every finger instead of
          // scrolling/zooming the page itself — required for pinch + draw.
          style={{
            cursor: spaceHeld || tool === "browse" ? "grab" : "default",
            touchAction: "none",
            overscrollBehavior: "contain",
          }}
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
              <div ref={pageWrapRef} className="relative h-fit">
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
                  // iOS cancels a pointer when the system takes the gesture
                  // (edge swipe, notification…): drop whatever it was doing.
                  onPointerCancel={() => {
                    cancelTouchTap();
                    selTapRef.current = null;
                    if (dragRef.current || moveRef.current) {
                      dragRef.current = null;
                      dragStartRef.current = null;
                      moveRef.current = null;
                      setEditGeom(null);
                    }
                    cropDragRef.current = false;
                  }}
                  onDoubleClick={(e) => onDoubleClick(e)}
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
                  {/* Crop tool: the dragged window, with the rest dimmed */}
                  {tool === "crop" && cropRect ? (
                    <g pointerEvents="none">
                      <path
                        d={`M0 0H${displayW}V${displayH}H0Z M${cropRect.x * scale} ${cropRect.y * scale}h${cropRect.w * scale}v${cropRect.h * scale}h${-cropRect.w * scale}Z`}
                        fill="rgba(0,0,0,0.45)"
                        fillRule="evenodd"
                      />
                      <rect
                        x={cropRect.x * scale}
                        y={cropRect.y * scale}
                        width={cropRect.w * scale}
                        height={cropRect.h * scale}
                        fill="none"
                        stroke="#A01C2D"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                      <text
                        x={cropRect.x * scale + 6}
                        y={cropRect.y * scale + 16}
                        fontSize={12}
                        fontWeight={700}
                        fill="#fff"
                        stroke="#000"
                        strokeWidth={3}
                        style={{ paintOrder: "stroke" }}
                      >
                        {(cropRect.w / PT_PER_IN).toFixed(1)}″ × {(cropRect.h / PT_PER_IN).toFixed(1)}″
                      </text>
                    </g>
                  ) : null}
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
                        {/* Handles: every vertex of the selection, in any tool
                            (a hold grabs one from a drawing tool too). The
                            active vertex (nudge pad) is filled; a fresh grab
                            pulses once so the finger knows it has it. */}
                        {isSel
                          ? pts.map((p, i) => {
                              const isActive = !!activeV && activeV.index === i;
                              const r = (coarse ? 11 : 5) + (isActive ? 2 : 0);
                              return (
                                <g key={i}>
                                  {isActive && grabPulse ? (
                                    <circle
                                      cx={p.x}
                                      cy={p.y}
                                      r={r * 2.2}
                                      fill={m.color ?? "#A01C2D"}
                                      fillOpacity={0.25}
                                      className="animate-ping"
                                      style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                                    />
                                  ) : null}
                                  <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={r}
                                    fill={isActive ? (m.color ?? "#A01C2D") : "#fff"}
                                    stroke={isActive ? "#fff" : (m.color ?? "#A01C2D")}
                                    strokeWidth={2}
                                    style={{ cursor: tool === "select" ? "grab" : "crosshair" }}
                                  />
                                </g>
                              );
                            })
                          : null}
                        {/* "+" midpoints on the selection: press one to add a
                            corner there (and carry it). Only on segments long
                            enough to leave room between the real handles. */}
                        {isSel && tool === "select" && !isCount && m.type !== "leader" && m.type !== "line"
                          ? plusHandles(m).map((h, i) => {
                              const c = px(h.p);
                              const r = coarse ? 8 : 4.5;
                              const col = m.color ?? "#A01C2D";
                              // End handles get a dotted tail back to the end vertex.
                              const tail = h.end ? px(h.end === "end" ? geom[geom.length - 1] : geom[0]) : null;
                              return (
                                <g key={`plus-${i}`} style={{ cursor: "copy" }}>
                                  {tail ? (
                                    <line x1={tail.x} y1={tail.y} x2={c.x} y2={c.y} stroke={col} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
                                  ) : null}
                                  <circle
                                    cx={c.x}
                                    cy={c.y}
                                    r={h.end ? r + 1 : r}
                                    fill="#fff"
                                    fillOpacity={0.9}
                                    stroke={col}
                                    strokeWidth={1.5}
                                    strokeDasharray={h.end ? undefined : "2 2"}
                                  />
                                  <path
                                    d={`M${c.x - r * 0.5} ${c.y}H${c.x + r * 0.5}M${c.x} ${c.y - r * 0.5}V${c.y + r * 0.5}`}
                                    stroke={col}
                                    strokeWidth={1.5}
                                  />
                                </g>
                              );
                            })
                          : null}
                      </g>
                    );
                  })}
                  {/* Each area's own value, written across the middle of it */}
                  {areaLabels.map((lbl) => (
                    <text
                      key={`area:${lbl.id}`}
                      x={lbl.x}
                      y={lbl.y}
                      fontSize={LABEL_FONT}
                      fontWeight={700}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      stroke="#000"
                      strokeWidth={3.5}
                      style={{ paintOrder: "stroke", pointerEvents: "none" }}
                    >
                      {lbl.text}
                    </text>
                  ))}
                  {/* Layer totals — one label per layer (see labelLayout) */}
                  {layerLabels.map(([key, lbl]) => (
                    <text
                      key={key}
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
                  ))}
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
                  {/* Touch rubber band: updated directly on each move (updateRubber),
                      never through state. Hidden unless a finger is aiming. */}
                  <g ref={rubberRef} style={{ display: "none", pointerEvents: "none" }}>
                    <polygon data-aim="fill" points="" fillOpacity={0.15} stroke="none" style={{ display: "none" }} />
                    <line data-aim="seg" strokeWidth={2} strokeDasharray="6 4" style={{ display: "none" }} />
                    <line data-aim="close" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6} style={{ display: "none" }} />
                    {/* The aim target: a ring and crosshair on the lifted point */}
                    <circle data-aim="dot" r={7} fill="none" strokeWidth={2} />
                    <path data-aim="cross" fill="none" strokeWidth={2} />
                    <text
                      data-aim="label"
                      fontSize={LABEL_FONT}
                      fontWeight={700}
                      fill="#fff"
                      stroke="#000"
                      strokeWidth={3.5}
                      style={{ paintOrder: "stroke", display: "none" }}
                    />
                  </g>
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
        </div>

        {/* Loupe: what's under the fingertip, magnified, above the finger */}
        {/* Save / tool errors — visible as a toast (they used to be set but
            only rendered on the loading screen, so a failed save just looked
            like the shape vanishing). */}
        {status === "ready" && error ? (
          <div
            role="alert"
            className="absolute left-1/2 top-3 z-40 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-brand/40 bg-brand/90 px-4 py-2.5 text-sm text-white shadow-xl"
          >
            <span className="min-w-0">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="min-h-0 shrink-0 rounded-md px-2 py-0.5 text-white/80 hover:text-white"
            >
              ✕
            </button>
          </div>
        ) : null}

        {/* Loupe: always in the DOM, shown/moved imperatively while a finger
            aims (see showLoupeAt) so no render happens per move. */}
        <div
          ref={loupeElRef}
          hidden
          className="pointer-events-none absolute z-30 overflow-hidden rounded-full border-2 border-brand bg-white shadow-xl"
          style={{ width: 120, height: 120 }}
          aria-hidden
        >
          <canvas ref={loupeCanvasRef} width={120} height={120} className="block" />
        </div>

        {/* Leader note card: where the note is typed on a phone (the side
            panel is hidden there) — text, text size, arrowhead size. */}
        {selected?.type === "leader" && (coarse || !panelOpen) && !menu && draft.length === 0 ? (
          <div className="glass-strong absolute bottom-14 left-2 right-2 z-20 rounded-2xl p-2.5 text-xs sm:left-auto sm:w-80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted">Leader note</span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-md px-2 py-1 text-foreground hover:text-brand-soft"
              >
                Done
              </button>
            </div>
            <textarea
              value={selected.text ?? ""}
              onChange={(e) => updateLeader({ text: e.target.value })}
              rows={2}
              autoFocus={!(selected.text ?? "").trim()}
              spellCheck
              placeholder="What is the arrow pointing at?"
              className="mt-1 w-full resize-none rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted/50 focus:border-brand focus:outline-none"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {(
                [
                  ["Text size", "font_size", LEADER_FONT_DEFAULT, 6, 96],
                  ["Arrowhead", "head_size", LEADER_HEAD_DEFAULT, 4, 60],
                ] as const
              ).map(([label, key, dflt, lo, hi]) => {
                const cur = selected[key] ?? dflt;
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
                    <button
                      type="button"
                      aria-label={`${label} smaller`}
                      onClick={() => updateLeader({ [key]: Math.max(lo, cur - 2) })}
                      className="h-9 w-9 min-h-0 rounded-md border border-border text-base text-foreground hover:border-brand"
                    >
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums text-foreground">{Math.round(cur)}</span>
                    <button
                      type="button"
                      aria-label={`${label} larger`}
                      onClick={() => updateLeader({ [key]: Math.min(hi, cur + 2) })}
                      className="h-9 w-9 min-h-0 rounded-md border border-border text-base text-foreground hover:border-brand"
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Nudge pad: fine-tune the tapped vertex one step at a time. A fixed
            3×3 cross of 44 px arrows (explicit grid cells — nothing floats or
            overlaps) plus step, Delete point and Done, tucked bottom-right.
            Mouse only (2026-09-10, Erfan): on a phone it covered a quarter of
            the drawing, and the corner handles + the lens are the way to
            place and adjust. Delete point lives in the hold menu there. */}
        {!coarse && activeV && selected && selected.type !== "leader" && draft.length === 0 && !menu ? (
          <div
            className="glass-strong absolute bottom-14 right-2 z-20 flex items-center gap-2 rounded-2xl p-1.5 text-xs"
            role="group"
            aria-label="Nudge the selected point"
          >
            <div
              className="grid gap-0.5"
              style={{ gridTemplateColumns: "repeat(3, 2.75rem)", gridTemplateRows: "repeat(3, 2.75rem)" }}
            >
              {(
                [
                  [0, -1, "↑", "up", 2, 1],
                  [-1, 0, "←", "left", 1, 2],
                  [1, 0, "→", "right", 3, 2],
                  [0, 1, "↓", "down", 2, 3],
                ] as const
              ).map(([dx, dy, glyph, name, col, row]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={`Nudge ${name}`}
                  onClick={() => nudgeActive(dx, dy)}
                  style={{ gridColumn: col, gridRow: row }}
                  className="flex h-11 w-11 min-h-0 items-center justify-center rounded-lg border border-border text-lg text-foreground hover:border-brand"
                >
                  {glyph}
                </button>
              ))}
              <span
                style={{ gridColumn: 2, gridRow: 2 }}
                className="flex items-center justify-center text-[10px] tabular-nums text-muted"
                aria-label={`Point ${activeV.index + 1} of ${selected.geometry.length}`}
              >
                {activeV.index + 1}/{selected.geometry.length}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <select
                value={nudgeUnit}
                onChange={(e) => setNudgeStep(e.target.value as "qft" | "ft" | "px")}
                aria-label="Nudge step"
                className="h-9 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
              >
                {hasScale ? <option value="qft">¼ ft</option> : null}
                {hasScale ? <option value="ft">1 ft</option> : null}
                <option value="px">1 px</option>
              </select>
              {selected.geometry.length > minPointsOf(selected) || selected.type === "count" ? (
                <button
                  type="button"
                  onClick={() => deleteVertex(selected.id, activeV.index)}
                  className="h-9 min-h-0 rounded-md border border-brand/40 bg-brand/10 px-2 text-brand-soft hover:bg-brand/20"
                >
                  {selected.type === "count" ? "Delete marker" : "Delete point"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setActiveVertex(null)}
                className="h-9 min-h-0 rounded-md border border-border px-2 text-foreground hover:border-brand"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {/* While drawing: Finish / Undo point / Cancel — no double-tap or
            precise "tap the last vertex" needed. Works for mouse too. */}
        {draft.length > 0 && tool !== "crop" ? (
          (() => {
            const multi = tool === "polyline" || tool === "area" || tool === "wall" || tool === "volume";
            const fill = tool === "area" || (tool === "volume" && volMode === "area");
            const minPts = fill ? 3 : 2;
            return (
              <div className="glass-strong absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs">
                <span className="px-1.5 text-muted tabular-nums">
                  {draft.length} pt{draft.length > 1 ? "s" : ""}
                </span>
                {multi ? (
                  <button
                    type="button"
                    onClick={onDoubleClick}
                    disabled={draft.length < minPts}
                    className="rounded-full bg-brand px-3 py-1 font-medium text-white disabled:opacity-40"
                  >
                    ✓ {fill ? "Close shape" : "Finish"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDraft((d) => d.slice(0, -1))}
                  className="rounded-full border border-border px-2.5 py-1 text-foreground"
                >
                  Undo point
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft([]);
                    setHover(null);
                  }}
                  className="rounded-full px-2 py-1 text-muted"
                >
                  Cancel
                </button>
              </div>
            );
          })()
        ) : null}

        {/* Crop tool panel: paper shape, orientation, name, create */}
        {tool === "crop" ? (
          <div className="glass-strong absolute bottom-12 left-3 z-20 w-[min(18rem,calc(100%-1.5rem))] rounded-xl p-3 text-sm">
            <p className="text-xs uppercase tracking-wider text-muted">Crop to a new sheet</p>
            <p className="mt-0.5 text-[11px] text-muted">
              Drag a box on the drawing. The original sheet stays as it is; the crop becomes its own sheet
              with its own name, category, notes and measurements.
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <select
                value={cropPreset}
                onChange={(e) => setCropPreset(e.target.value)}
                aria-label="Paper shape"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
              >
                {PAPER.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {cropPreset !== "free" ? (
                <button
                  type="button"
                  onClick={() => setCropLandscape((v) => !v)}
                  title="Rotate the shape"
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-brand"
                >
                  {cropLandscape ? "▭ Landscape" : "▯ Portrait"}
                </button>
              ) : null}
            </div>
            <input
              value={cropName}
              onChange={(e) => setCropName(e.target.value)}
              placeholder={currentSheet ? `${sheetTitle(currentSheet)} — crop` : "New sheet name"}
              spellCheck
              aria-label="New sheet name"
              className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={createCroppedSheet}
                disabled={!cropRect || cropBusy}
                className="glass-brand rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
              >
                {cropBusy ? "Saving…" : "Create sheet from crop"}
              </button>
              <button
                type="button"
                onClick={() => setCropDraft(null)}
                disabled={!cropRect}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40"
              >
                Clear
              </button>
              {cropRect ? (
                <span className="ml-auto text-[11px] text-muted tabular-nums">
                  {(cropRect.w / PT_PER_IN).toFixed(1)}″ × {(cropRect.h / PT_PER_IN).toFixed(1)}″
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Sheet notes — floats just above the bottom bar when open */}
        {notesOpen ? (
          <div className="absolute bottom-11 left-1/2 z-20 w-[min(720px,92%)] -translate-x-1/2">
            <div className="glass-strong rounded-2xl p-4">
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
                  {/* Dictate: speak, the AI writes the notes */}
                  <button
                    type="button"
                    onClick={voiceState === "listening" ? stopVoice : startVoice}
                    disabled={voiceState === "thinking" || voiceState === "unsupported"}
                    aria-pressed={voiceState === "listening"}
                    title={
                      voiceState === "unsupported"
                        ? "Voice input isn't available in this browser"
                        : "Dictate notes about this sheet"
                    }
                    className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      voiceState === "listening"
                        ? "border-brand bg-brand text-white"
                        : "border-border text-foreground hover:border-brand"
                    }`}
                  >
                    {voiceState === "listening" ? (
                      <>
                        <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
                        Stop
                      </>
                    ) : voiceState === "thinking" ? (
                      "Writing notes…"
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                          <rect x="9" y="3" width="6" height="11" rx="3" />
                          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" strokeLinecap="round" />
                        </svg>
                        Dictate
                      </>
                    )}
                  </button>
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
              {voiceState === "listening" ? (
                <p className="mb-1.5 min-h-5 text-xs text-muted">
                  {voiceInterim ? <span className="text-foreground">{voiceInterim}</span> : "Listening… say what the AI should know about this sheet."}
                </p>
              ) : null}
              {voiceState === "unsupported" ? (
                <p className="mb-1.5 text-xs text-muted">Voice input isn&apos;t available in this browser — type the note instead.</p>
              ) : null}
              {voiceErr ? <p className="mb-1.5 text-xs text-brand-soft">{voiceErr}</p> : null}
              <textarea
                id="sheet-notes"
                value={currentSheet ? notes[currentSheet.id] ?? "" : ""}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={(e) => saveNotes(e.currentTarget.value)}
                rows={5}
                spellCheck
                placeholder={
                  "Tell the AI anything it should know about this sheet, e.g.\n" +
                  "• Unit A dimensions are on this sheet\n" +
                  "• Exterior walls are 8\" CMU, interior are 2x4 wood\n" +
                  "• Door & window schedule is on sheet A-6\n" +
                  "• Exclude the canopy — owner-furnished"
                }
                className="max-h-[40vh] min-h-[7rem] w-full resize-y rounded-lg border border-border bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted/50 focus:border-brand focus:outline-none"
              />
            </div>
          </div>
        ) : null}

        {/* Bottom bar: tool hint · page browser · notes toggle. It sits BELOW
            the drawing rather than floating over it, so the pager and the
            notes never fight for the same corner and nothing hides the sheet. */}
        <div className="glass-strong pb-safe z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1.5">
          {/* Phones keep the app's stage tab bar under this one (2026-09-10:
              hiding it made the takeoff feel like leaving the app), so there
              is no Back / Go to here any more — the left cell is empty below
              md and the pager stays centred. */}
          <div className="md:hidden" />
          <p className="hidden min-w-0 truncate text-[11px] text-muted md:block">
            {status === "ready" ? (
              <>
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
              </>
            ) : null}
          </p>
          {/* Pager walks the SHEET list (pages + their crops), not raw page numbers. */}
          <div className="flex items-center gap-1.5 text-sm text-foreground">
            <button
              type="button"
              onClick={() =>
                sheetList.length
                  ? sheetIndex > 0 && openSheet(sheetList[sheetIndex - 1])
                  : setPageNum((p) => Math.max(1, p - 1))
              }
              disabled={sheetList.length ? sheetIndex <= 0 : pageNum <= 1}
              title="Previous sheet"
              className="rounded-md border border-border px-2.5 py-0.5 hover:border-brand disabled:opacity-40"
            >
              ‹
            </button>
            <span className="tabular-nums" title={crop ? `Crop of page ${pageNum}` : `Page ${pageNum}`}>
              {sheetList.length ? `${sheetIndex + 1} / ${sheetList.length}` : `${pageNum} / ${numPages || "…"}`}
              {crop ? <span className="ml-1 text-[10px] uppercase text-muted">crop</span> : null}
            </span>
            <button
              type="button"
              onClick={() =>
                sheetList.length
                  ? sheetIndex < sheetList.length - 1 && openSheet(sheetList[sheetIndex + 1])
                  : setPageNum((p) => Math.min(numPages, p + 1))
              }
              disabled={sheetList.length ? sheetIndex >= sheetList.length - 1 : pageNum >= numPages}
              title="Next sheet"
              className="rounded-md border border-border px-2.5 py-0.5 hover:border-brand disabled:opacity-40"
            >
              ›
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNotesOpen((o) => !o)}
            title="Sheet notes for the AI"
            aria-expanded={notesOpen}
            className={`justify-self-end flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              notesOpen
                ? "border-brand bg-brand/20 text-foreground"
                : "border-border text-foreground hover:border-brand"
            }`}
          >
            <span aria-hidden>📝</span>
            <span className="hidden sm:inline">Notes for AI</span>
            {currentSheet && (notes[currentSheet.id] ?? "").trim() ? (
              <span className="text-brand-soft" title="This sheet has notes">•</span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Right rail (collapsible + resizable): edit selected OR list. On a
          phone it is a bottom sheet over the drawing; a tap on the drawing
          (the backdrop) closes it. */}
      {panelOpen ? (
        <>
          {phone ? (
            <div
              className="fixed inset-0 z-30 bg-background/60"
              aria-hidden
              onPointerDown={() => setPanelOpen(false)}
            />
          ) : (
            <div
              className="resize-handle z-10"
              onPointerDown={(e) => startResize("right", e)}
            />
          )}
          <aside
            className={
              phone
                ? "glass-strong pb-safe fixed inset-x-0 bottom-0 z-40 flex max-h-[60vh] flex-col overflow-hidden rounded-t-2xl"
                : "glass z-10 flex shrink-0 flex-col"
            }
            style={phone ? undefined : { width: panelW }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
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
                className="rounded-md border border-border px-2 py-0.5 text-muted transition-colors hover:border-brand hover:text-foreground"
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
                    spellCheck
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
                : coarse
                  ? "Tip: drag a white handle to reshape (the lens shows where it lands) · hold a handle to split or delete."
                  : "Tip: drag the white handles on the sheet to reshape · click a handle for the nudge pad."}
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
            <div className="border-b border-border px-4 py-3">
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
                  const toggleHidden = () =>
                    setHiddenLayers((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.layer)) next.delete(g.layer);
                      else next.add(g.layer);
                      return next;
                    });
                  return (
                    // Touch: swipe left for Hide / Delete, hold for every
                    // action. The row's own buttons stay for everyone.
                    <SwipeRow
                      key={g.layer}
                      className="mb-1 rounded-md"
                      actions={[
                        { label: isHidden ? "Show" : "Hide", onClick: toggleHidden },
                        { label: "Delete", onClick: () => deleteLayer(g.rows), tone: "danger" },
                      ]}
                      sheetActions={[
                        {
                          label: isRecording ? "Stop recording" : "Draw into this layer",
                          onClick: () => (isRecording ? setTool("select") : continueLayer(g)),
                          tone: "primary",
                        },
                        { label: "Rename / settings", onClick: () => openLayerEditor(g) },
                        { label: isHidden ? "Show on sheet" : "Hide from sheet", onClick: toggleHidden },
                        { label: "Delete layer", onClick: () => deleteLayer(g.rows), tone: "danger" },
                      ]}
                    >
                    <div
                      className={`rounded-md border border-border ${isHidden ? "opacity-50" : ""}`}
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
                          aria-label={isRecording ? "Stop recording into this layer" : "Record into this layer"}
                          className="flex h-9 w-8 shrink-0 items-center justify-center"
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
                        <div className="flex flex-col gap-2 border-t border-border px-2 pb-2 pt-2">
                          {/* Rename — applies to every run in the layer.
                              Saves by itself when you tab/click away (or
                              press Enter); no button to remember. */}
                          <div className="flex items-center gap-1.5">
                            <input
                              value={layerName}
                              onChange={(e) => setLayerName(e.target.value)}
                              onBlur={() => {
                                if (layerName.trim() && layerName.trim() !== g.layer)
                                  renameLayer(g.rows, layerName);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  if (layerName.trim() && layerName.trim() !== g.layer)
                                    renameLayer(g.rows, layerName);
                                  setEditingLayer(null);
                                }
                                if (e.key === "Escape") setEditingLayer(null);
                              }}
                              placeholder="Layer name"
                              spellCheck
                              aria-label="Layer name"
                              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                            />
                            <span className="shrink-0 text-[10px] text-muted">saves as you go</span>
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
                    </SwipeRow>
                  );
                })
              )}
            </div>
          </>
            )}
          </aside>
        </>
      ) : null}

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
            ref={menuRef}
            className="glass-strong fixed z-[61] min-w-[170px] rounded-xl p-1 text-sm"
            // Placed by the layout effect below once its size is known: it
            // flips upward from a low item and never leaves the screen.
            style={{ left: menu.x, top: menu.y, visibility: "hidden" }}
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
                className={`block w-full rounded-lg px-3 py-1.5 text-left transition-colors pointer-coarse:min-h-11 pointer-coarse:py-2.5 ${
                  it.danger
                    ? "text-brand-soft hover:bg-brand/20"
                    : "text-foreground hover:bg-foreground/10"
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
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-foreground hover:bg-foreground/5"
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
