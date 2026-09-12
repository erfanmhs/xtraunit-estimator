/**
 * Browser side of "Find all like this": turn the rendered sheet canvas into
 * an ink image at a working resolution, cut the template out of it, and run
 * the search in a Worker (falling back to the main thread if Workers are
 * unavailable). Coordinates in and out are PDF points, the viewer's space.
 */
import type { Pt } from "./geometry";
import { crop, findAll, toInk, type Gray, type Match, type MatchOptions } from "./templateMatch";
import type { WorkerIn, WorkerOut } from "./templateMatch.worker";

/** Work at a resolution where the symbol box is about this many pixels across. */
const TEMPLATE_PX = 36;

/**
 * Rasterise the sheet canvas (drawn at `rasterScale` px per PDF point) at a
 * working scale chosen so the symbol box is ~36 px, and return the ink image
 * plus the px-per-point of that image.
 */
export function inkFromCanvas(
  canvas: HTMLCanvasElement,
  rasterScale: number,
  boxPt: number,
): { ink: Gray; pxPerPt: number } | null {
  const want = TEMPLATE_PX / boxPt; // px per PDF point we'd like
  const pxPerPt = Math.min(rasterScale, want);
  const k = pxPerPt / rasterScale; // ≤ 1
  const w = Math.max(1, Math.round(canvas.width * k));
  const h = Math.max(1, Math.round(canvas.height * k));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  try {
    ctx.drawImage(canvas, 0, 0, w, h);
  } catch {
    return null;
  }
  const img = ctx.getImageData(0, 0, w, h);
  off.width = 0;
  off.height = 0;
  return { ink: toInk(img.data, w, h), pxPerPt: w / (canvas.width / rasterScale) };
}

/** The square template around a point, in the ink image's pixels. */
export function templateAround(ink: Gray, pxPerPt: number, centre: Pt, boxPt: number): Gray {
  const s = Math.max(8, Math.round(boxPt * pxPerPt));
  const x0 = Math.round(centre.x * pxPerPt - s / 2);
  const y0 = Math.round(centre.y * pxPerPt - s / 2);
  return crop(ink, x0, y0, s, s);
}

function runInWorker(input: WorkerIn): Promise<Match[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./templateMatch.worker.ts", import.meta.url));
    } catch {
      resolve(findAll(input.source, input.template, input.opts));
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      worker.terminate();
      if ("error" in e.data) reject(new Error(e.data.error));
      else resolve(e.data.matches);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "search failed"));
    };
    worker.postMessage(input, [input.source.data.buffer, input.template.data.buffer]);
  });
}

/**
 * Find every copy of the symbol in the `boxPt`-wide square around `centre`.
 * Returns centres in PDF points with scores, best first.
 */
export async function findSymbolCopies(
  canvas: HTMLCanvasElement,
  rasterScale: number,
  centre: Pt,
  boxPt: number,
  opts: MatchOptions = {},
): Promise<{ pt: Pt; score: number }[]> {
  const prep = inkFromCanvas(canvas, rasterScale, boxPt);
  if (!prep) return [];
  const { ink, pxPerPt } = prep;
  const template = templateAround(ink, pxPerPt, centre, boxPt);
  const matches = await runInWorker({ source: ink, template, opts });
  return matches.map((m) => ({ pt: { x: m.x / pxPerPt, y: m.y / pxPerPt }, score: m.score }));
}
