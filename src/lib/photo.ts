/**
 * Phone photos, made usable.
 *
 * A camera shot from a phone arrives as 12 MP of HEIC or JPEG. Two things
 * downstream cannot take that as-is: the AI quote reader (jpeg/png/webp only,
 * and it pays per pixel) and the plan pipeline (PDF only). So a photo goes
 * through here first: decoded by the browser (Safari decodes HEIC itself),
 * shrunk so its long edge is at most `maxEdge`, and re-encoded as JPEG. A
 * sheet photo then gets wrapped into a one-page PDF so it can be measured
 * like any other plan.
 *
 * The geometry is a pure function (tested); the rest needs a browser.
 */
import { PDFDocument } from "pdf-lib";

/** Scale (w, h) so the longer edge is at most `max`, never upscaling. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number; scale: number } {
  const long = Math.max(w, h);
  if (long <= max || long === 0) return { w, h, scale: 1 };
  const scale = max / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
}

/** Long edge for a quote photo: enough to read small print, cheap to send. */
export const QUOTE_MAX_EDGE = 2000;
/** Long edge for a plan-sheet photo: dimensions and callouts need more. */
export const SHEET_MAX_EDGE = 3200;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation in current browsers; the
  // <img> fallback is for anything (HEIC on some builds) it refuses.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Decode, shrink and re-encode a photo as a JPEG File. */
export async function normalizePhoto(
  file: File,
  maxEdge: number,
  name = "photo.jpg",
): Promise<File> {
  const src = await decode(file);
  const sw = "width" in src ? src.width : (src as HTMLImageElement).naturalWidth;
  const sh = "height" in src ? src.height : (src as HTMLImageElement).naturalHeight;
  const { w, h } = fitWithin(sw, sh, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process photos.");
  ctx.fillStyle = "#fff"; // a transparent PNG would go black in a JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if ("close" in src) src.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Couldn't read that photo. Try again, or pick it from your library.");
  return new File([blob], name, { type: "image/jpeg" });
}

/**
 * One photo → a one-page PDF the plan pipeline can open, page sized to the
 * image so nothing is cropped. Scale is set later with the Calibrate tool,
 * the same as any scanned sheet.
 */
export async function photoToPdf(jpeg: File, name = "sheet-photo.pdf"): Promise<File> {
  const pdf = await PDFDocument.create();
  const img = await pdf.embedJpg(await jpeg.arrayBuffer());
  // 72 pt per "inch" of pixels at 200 dpi keeps a phone photo near letter size.
  const pts = 72 / 200;
  const page = pdf.addPage([img.width * pts, img.height * pts]);
  page.drawImage(img, { x: 0, y: 0, width: img.width * pts, height: img.height * pts });
  const bytes = await pdf.save();
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

/** "sheet-photo 2026-09-12 14-05.pdf" — sortable, no characters storage rejects. */
export function photoFileName(base: string, ext: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${base} ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}.${ext}`;
}
