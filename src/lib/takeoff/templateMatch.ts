/**
 * "Find all like this" — locate every copy of a small symbol (a door swing, a
 * window, a receptacle) on a rendered plan sheet.
 *
 * Plain normalized cross-correlation on grayscale pixels, done the way a
 * plan sheet lets you: most of a sheet is blank paper, so a window with no
 * ink is skipped before any multiplying happens; the search runs at a
 * coarse scale first (the symbol about 24 px across) and only the
 * candidates are re-checked at a finer scale. The symbol is tried in its
 * four rotations and their mirror images, because a door swings both ways.
 *
 * Pure functions over typed arrays — no DOM — so it runs the same in a
 * Web Worker and in the tests, which draw synthetic symbols and count what
 * comes back.
 */

/** Grayscale "ink" image: 0 = paper, 255 = solid line. Row-major. */
export type Gray = { w: number; h: number; data: Float32Array };

export type Match = {
  /** Centre of the found symbol, in the SOURCE image's pixel space. */
  x: number;
  y: number;
  /** Normalized cross-correlation, 0–1 (1 = identical). */
  score: number;
  /** Which orientation matched: 0–3 = rotations of 90°, +4 = mirrored. */
  variant: number;
};

export type MatchOptions = {
  /** Keep matches with at least this score. 0.72 is a good default for CAD drawings. */
  threshold?: number;
  /** Try rotations and mirror images (8 variants). Default true. */
  orientations?: boolean;
  /** Stop after this many, best first. Default 500. */
  limit?: number;
};

// ── Image helpers ──────────────────────────────────────────────────────────

/** RGBA pixels (ImageData.data) → ink image. White paper reads 0. */
export function toInk(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    // Luma, then invert so ink is high. Alpha is ignored (canvas is opaque).
    const l = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    data[i] = 255 - l;
  }
  return { w, h, data };
}

export function crop(g: Gray, x0: number, y0: number, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= g.h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= g.w) continue;
      data[y * w + x] = g.data[sy * g.w + sx];
    }
  }
  return { w, h, data };
}

/** Box-average downscale by an integer factor (≥ 1). */
export function downscale(g: Gray, f: number): Gray {
  if (f <= 1) return g;
  const w = Math.max(1, Math.floor(g.w / f));
  const h = Math.max(1, Math.floor(g.h / f));
  const data = new Float32Array(w * h);
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      const by = y * f;
      const bx = x * f;
      for (let dy = 0; dy < f; dy++) {
        const row = (by + dy) * g.w + bx;
        for (let dx = 0; dx < f; dx++) s += g.data[row + dx];
      }
      data[y * w + x] = s * inv;
    }
  }
  return { w, h, data };
}

/** Rotate 90° clockwise. */
export function rotate90(g: Gray): Gray {
  const w = g.h;
  const h = g.w;
  const data = new Float32Array(w * h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) data[x * w + (w - 1 - y)] = g.data[y * g.w + x];
  return { w, h, data };
}

/** Mirror left–right. */
export function mirror(g: Gray): Gray {
  const data = new Float32Array(g.w * g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) data[y * g.w + (g.w - 1 - x)] = g.data[y * g.w + x];
  return { w: g.w, h: g.h, data };
}

/** The 8 orientations of a template: 4 rotations, then the same 4 mirrored. */
export function orientations(t: Gray): Gray[] {
  const out: Gray[] = [t];
  for (let i = 1; i < 4; i++) out.push(rotate90(out[i - 1]));
  const m = mirror(t);
  out.push(m);
  for (let i = 5; i < 8; i++) out.push(rotate90(out[i - 1]));
  return out;
}

// ── Correlation ────────────────────────────────────────────────────────────

type Stats = { mean: number; norm: number; zero: Float32Array };

/** Zero-mean template and its norm; a flat template (no ink) has norm 0. */
function templateStats(t: Gray): Stats {
  const n = t.w * t.h;
  let s = 0;
  for (let i = 0; i < n; i++) s += t.data[i];
  const mean = s / n;
  const zero = new Float32Array(n);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const v = t.data[i] - mean;
    zero[i] = v;
    ss += v * v;
  }
  return { mean, norm: Math.sqrt(ss), zero };
}

/** Integral images of S and S², one row and column of padding. */
function integrals(g: Gray): { sum: Float64Array; sq: Float64Array; W: number } {
  const W = g.w + 1;
  const sum = new Float64Array(W * (g.h + 1));
  const sq = new Float64Array(W * (g.h + 1));
  for (let y = 1; y <= g.h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 1; x <= g.w; x++) {
      const v = g.data[(y - 1) * g.w + (x - 1)];
      rs += v;
      rq += v * v;
      sum[y * W + x] = sum[(y - 1) * W + x] + rs;
      sq[y * W + x] = sq[(y - 1) * W + x] + rq;
    }
  }
  return { sum, sq, W };
}

/**
 * NCC of one template against every position of the source. Returns a score
 * map (source-sized; positions where the template would run off the edge, or
 * the window is blank, stay 0). `x,y` in the map is the template's top-left.
 */
export function correlate(src: Gray, tpl: Gray): Float32Array {
  const out = new Float32Array(src.w * src.h);
  const { w: tw, h: th } = tpl;
  if (tw > src.w || th > src.h) return out;
  const n = tw * th;
  const T = templateStats(tpl);
  if (T.norm < 1e-3) return out;
  const { sum, sq, W } = integrals(src);
  // A window with less than 5 % of the template's ink energy cannot be a
  // match; on a plan sheet that rules out most of the page in O(1) each.
  const minVar = 0.05 * (T.norm * T.norm);
  const maxX = src.w - tw;
  const maxY = src.h - th;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      const a = y * W + x;
      const b = a + tw;
      const c = (y + th) * W + x;
      const d = c + tw;
      const s = sum[d] - sum[b] - sum[c] + sum[a];
      const q = sq[d] - sq[b] - sq[c] + sq[a];
      const varN = q - (s * s) / n; // Σ(S - meanS)²
      if (varN < minVar) continue;
      const meanS = s / n;
      let dot = 0;
      let ti = 0;
      for (let ty = 0; ty < th; ty++) {
        let si = (y + ty) * src.w + x;
        for (let tx = 0; tx < tw; tx++, ti++, si++) dot += (src.data[si] - meanS) * T.zero[ti];
      }
      out[y * src.w + x] = dot / (Math.sqrt(varN) * T.norm);
    }
  }
  return out;
}

/** Local maxima above `threshold`, thinned so no two are within `radius`. */
export function peaks(
  map: Float32Array,
  w: number,
  h: number,
  threshold: number,
  radius: number,
): { x: number; y: number; score: number }[] {
  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = map[y * w + x];
      if (v >= threshold) cands.push({ x, y, score: v });
    }
  cands.sort((a, b) => b.score - a.score);
  const kept: { x: number; y: number; score: number }[] = [];
  const r2 = radius * radius;
  for (const c of cands) {
    let near = false;
    for (const k of kept) {
      const dx = k.x - c.x;
      const dy = k.y - c.y;
      if (dx * dx + dy * dy < r2) {
        near = true;
        break;
      }
    }
    if (!near) kept.push(c);
  }
  return kept;
}

// ── The search ─────────────────────────────────────────────────────────────

/** Integer downscale factor that brings the template's long edge to ~target px. */
function factorFor(t: Gray, target: number): number {
  return Math.max(1, Math.round(Math.max(t.w, t.h) / target));
}

/**
 * Find every copy of `template` in `source`. Coarse pass at ~12 px, refine
 * survivors at ~36 px, results in source pixels (centres).
 */
export function findAll(source: Gray, template: Gray, opts: MatchOptions = {}): Match[] {
  const threshold = opts.threshold ?? 0.72;
  const limit = opts.limit ?? 500;
  const variants = opts.orientations === false ? [template] : orientations(template);

  // Coarse at ~12 px across: a door swing is still a door swing at that
  // size, and the sheet shrinks by the square of the factor. Refine at ~36.
  const fc = factorFor(template, 12);
  const ff = Math.max(1, Math.min(fc, factorFor(template, 36)));
  const coarseSrc = downscale(source, fc);
  const fineSrc = ff === fc ? coarseSrc : downscale(source, ff);

  // Coarse: a looser bar, so a slightly off-grid copy is not lost before refinement.
  const loose = Math.max(0.3, threshold - 0.15);
  const found: Match[] = [];
  const seen: { x: number; y: number }[] = [];
  const tplRadius = Math.max(template.w, template.h) / 2; // source px

  variants.forEach((v, vi) => {
    const cv = downscale(v, fc);
    const map = correlate(coarseSrc, cv);
    const ps = peaks(map, coarseSrc.w, coarseSrc.h, loose, Math.max(2, Math.min(cv.w, cv.h) * 0.5));
    if (!ps.length) return;
    const fv = ff === fc ? cv : downscale(v, ff);
    const F = templateStats(fv);
    const { sum, sq, W } = integrals(fineSrc);
    const n = fv.w * fv.h;
    for (const p of ps) {
      // Map the coarse top-left to fine space and search a small neighbourhood.
      const gx = Math.round((p.x * fc) / ff);
      const gy = Math.round((p.y * fc) / ff);
      let best = -1;
      let bx = gx;
      let by = gy;
      const R = Math.max(1, Math.round(fc / ff)) + 1;
      for (let y = gy - R; y <= gy + R; y++) {
        if (y < 0 || y + fv.h > fineSrc.h) continue;
        for (let x = gx - R; x <= gx + R; x++) {
          if (x < 0 || x + fv.w > fineSrc.w) continue;
          const a = y * W + x;
          const b = a + fv.w;
          const c = (y + fv.h) * W + x;
          const d = c + fv.w;
          const s = sum[d] - sum[b] - sum[c] + sum[a];
          const q = sq[d] - sq[b] - sq[c] + sq[a];
          const varN = q - (s * s) / n;
          if (varN <= 1e-6) continue;
          const meanS = s / n;
          let dot = 0;
          let ti = 0;
          for (let ty = 0; ty < fv.h; ty++) {
            let si = (y + ty) * fineSrc.w + x;
            for (let tx = 0; tx < fv.w; tx++, ti++, si++) dot += (fineSrc.data[si] - meanS) * F.zero[ti];
          }
          const sc = dot / (Math.sqrt(varN) * F.norm);
          if (sc > best) {
            best = sc;
            bx = x;
            by = y;
          }
        }
      }
      if (best < threshold) continue;
      // Centre in source pixels. Rotated variants have swapped w/h.
      const cx = (bx + fv.w / 2) * ff;
      const cy = (by + fv.h / 2) * ff;
      // One symbol, one match — across variants too (a symmetric symbol
      // matches its own mirror at the same spot). The better score wins.
      let dupAt = -1;
      for (let i = 0; i < seen.length; i++) {
        if (Math.hypot(seen[i].x - cx, seen[i].y - cy) < tplRadius) {
          dupAt = i;
          break;
        }
      }
      if (dupAt >= 0) {
        if (found[dupAt].score < best) found[dupAt] = { x: cx, y: cy, score: best, variant: vi };
        continue;
      }
      seen.push({ x: cx, y: cy });
      found.push({ x: cx, y: cy, score: best, variant: vi });
    }
  });

  found.sort((a, b) => b.score - a.score);
  return found.slice(0, limit);
}
