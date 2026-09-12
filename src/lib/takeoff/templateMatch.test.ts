import { describe, expect, it } from "vitest";
import {
  correlate,
  crop,
  downscale,
  findAll,
  mirror,
  orientations,
  peaks,
  rotate90,
  toInk,
  type Gray,
} from "./templateMatch";

// ── A tiny drawing kit ─────────────────────────────────────────────────────
function blank(w: number, h: number): Gray {
  return { w, h, data: new Float32Array(w * h) };
}
function px(g: Gray, x: number, y: number, v = 255) {
  if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.data[y * g.w + x] = v;
}
function line(g: Gray, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) px(g, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n));
}
/** A door symbol: jamb, leaf, and a quarter-arc swing — 24×24. */
function door(): Gray {
  const g = blank(24, 24);
  line(g, 2, 2, 2, 21); // jamb
  line(g, 2, 21, 21, 21); // leaf (open 90°)
  // quarter arc from the leaf tip up to the jamb top
  for (let a = 0; a <= 90; a += 3) {
    const r = (a * Math.PI) / 180;
    px(g, Math.round(2 + 19 * Math.sin(r)), Math.round(21 - 19 * (1 - Math.cos(r))));
  }
  return g;
}
function stamp(dst: Gray, src: Gray, x0: number, y0: number) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (v > 0) px(dst, x0 + x, y0 + y, v);
    }
}
/** A window symbol — three parallel lines — should NOT match a door. */
function windowSym(): Gray {
  const g = blank(24, 24);
  line(g, 2, 10, 21, 10);
  line(g, 2, 12, 21, 12);
  line(g, 2, 14, 21, 14);
  return g;
}

describe("image helpers", () => {
  it("toInk makes white paper 0 and black ink 255", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const g = toInk(rgba, 2, 1);
    expect(g.data[0]).toBeCloseTo(0, 3);
    expect(g.data[1]).toBeCloseTo(255, 3);
  });
  it("rotate90 four times and mirror twice return the original", () => {
    const d = door();
    let r = d;
    for (let i = 0; i < 4; i++) r = rotate90(r);
    expect(Array.from(r.data)).toEqual(Array.from(d.data));
    expect(Array.from(mirror(mirror(d)).data)).toEqual(Array.from(d.data));
    expect(orientations(d)).toHaveLength(8);
  });
  it("downscale averages boxes", () => {
    const g = blank(4, 4);
    px(g, 0, 0);
    px(g, 1, 1);
    const s = downscale(g, 2);
    expect(s.w).toBe(2);
    expect(s.data[0]).toBeCloseTo(127.5, 3);
    expect(s.data[3]).toBe(0);
  });
});

describe("correlate + peaks", () => {
  it("scores the exact spot ~1 and blank paper 0", () => {
    const sheet = blank(80, 60);
    const d = door();
    stamp(sheet, d, 30, 20);
    const map = correlate(sheet, d);
    expect(map[20 * 80 + 30]).toBeGreaterThan(0.99);
    expect(map[0]).toBe(0);
    const ps = peaks(map, 80, 60, 0.9, 12);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ x: 30, y: 20 });
  });
});

describe("findAll — every copy of a symbol, in any orientation", () => {
  it("finds five doors (two rotated, one mirrored) and ignores windows and walls", () => {
    const sheet = blank(320, 240);
    const d = door();
    const placed = [
      { g: d, x: 20, y: 20 },
      { g: d, x: 200, y: 30 },
      { g: rotate90(d), x: 60, y: 150 },
      { g: rotate90(rotate90(d)), x: 250, y: 160 },
      { g: mirror(d), x: 140, y: 100 },
    ];
    for (const p of placed) stamp(sheet, p.g, p.x, p.y);
    // Distractors: two windows and a long wall.
    stamp(sheet, windowSym(), 100, 200);
    stamp(sheet, windowSym(), 280, 90);
    line(sheet, 0, 120, 319, 120);

    // The template is what the user boxed: the first door, with a little margin.
    const tpl = crop(sheet, 18, 18, 28, 28);
    const found = findAll(sheet, tpl, { threshold: 0.7 });

    expect(found.length).toBe(5);
    for (const p of placed) {
      const cx = p.x + p.g.w / 2;
      const cy = p.y + p.g.h / 2;
      const hit = found.find((f) => Math.hypot(f.x - cx, f.y - cy) <= 3);
      expect(hit, `door at ${cx},${cy}`).toBeDefined();
    }
  });

  it("finds nothing on blank paper and nothing when orientations are off and the copy is rotated", () => {
    const d = door();
    const tpl = crop(d, 0, 0, 24, 24);
    expect(findAll(blank(200, 200), tpl)).toHaveLength(0);
    const sheet = blank(120, 120);
    stamp(sheet, rotate90(d), 40, 40);
    expect(findAll(sheet, tpl, { orientations: false, threshold: 0.7 })).toHaveLength(0);
    expect(findAll(sheet, tpl, { threshold: 0.7 })).toHaveLength(1);
  });

  it("stays fast on a sheet-sized image (1600×1200, 40 doors)", () => {
    const sheet = blank(1600, 1200);
    const d = door();
    let n = 0;
    for (let y = 40; y < 1150; y += 140)
      for (let x = 40; x < 1550; x += 300) {
        stamp(sheet, n % 3 === 0 ? rotate90(d) : d, x, y);
        n++;
      }
    for (let y = 0; y < 1200; y += 97) line(sheet, 0, y, 1599, y); // "walls"
    const tpl = crop(sheet, 38, 38, 28, 28);
    const t0 = performance.now();
    const found = findAll(sheet, tpl, { threshold: 0.7 });
    const ms = performance.now() - t0;
    expect(found.length).toBe(n);
    expect(ms).toBeLessThan(4000);
  });
});
