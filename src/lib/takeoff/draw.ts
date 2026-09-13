/**
 * Drawing takeoff markup onto a 2D canvas — the marked-up PDF export. Mirrors
 * the on-screen SVG overlay so exports look like the live sheet. Pure: a
 * context, the measurements, and the export scale in.
 */
import { polyCentroid, type Pt } from "./geometry";
import { buildLayerGroups, labelText } from "./measurements";
import {
  LEADER_FONT_DEFAULT,
  LEADER_HEAD_DEFAULT,
  LEDGER_BASE_FONT,
  LEDGER_BASE_W,
  type Ledger,
  type Measurement,
} from "./model";

export function hexToRgba(hex: string, a: number): string {
  const h = (hex || "#A01C2D").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

// Draw all takeoff markup onto a 2D canvas at exportScale k (PDF points × k).
// Mirrors the on-screen SVG overlay so exports look like the live sheet.
export function drawMarkupOnCanvas(
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
export function drawLedgerOnCanvas(
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
