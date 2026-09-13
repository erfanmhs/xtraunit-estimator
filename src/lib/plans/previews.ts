/**
 * Page previews that a phone can afford.
 *
 * A scanned plan sheet is one enormous JPEG — 24×36 in at 300 dpi is
 * 78 million pixels, 300 MB once decoded. pdf.js decodes it in full in its
 * worker just to draw a 180 px thumbnail, and an iPhone kills the tab
 * (Erfan's Google Drive set, twice). The browser's own image decoder can
 * scale while it decodes and works in native memory, so for a page that is
 * essentially one JPEG we hand that JPEG — the raw, still-compressed bytes,
 * pulled straight out of the PDF with pdf-lib — to the browser and let it
 * make the thumbnail. Drawn pages go to lib/plans/thumbnailers.ts.
 *
 * "One JPEG" means exactly that: the page's drawing is a single Do of the
 * image and nothing else. A rendering photo or a designer's logo is also a
 * big JPEG, on a page full of other drawing — the Santa Clara set showed a
 * 2,000 px "DO Design" logo as the preview of three sheets. So a page counts
 * as a scan only when its content stream is tiny (see `scanPageJpeg`).
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, type PDFDocument } from "pdf-lib";

export type PageJpeg = { bytes: Uint8Array; width: number; height: number };

/**
 * The largest DCT-encoded (JPEG) image among a page's XObjects, still
 * compressed, or null when the page has none. `minCoverage` skips small
 * inset images (a logo, a north arrow) so a drawn page with a photo on it
 * still gets a real render.
 */
export function largestPageJpeg(doc: PDFDocument, pageIndex: number, minCoverage = 0.4): PageJpeg | null {
  const page = doc.getPage(pageIndex);
  const resources = page.node.Resources();
  if (!resources) return null;
  const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return null;
  const { width: pw, height: ph } = page.getSize();
  const pageArea = Math.max(1, pw * ph);
  let best: PageJpeg | null = null;
  for (const [, ref] of xobjects.entries()) {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const dict = stream.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"));
    const isDct =
      filter === PDFName.of("DCTDecode") ||
      (filter !== undefined && String(filter).includes("DCTDecode") && !String(filter).includes("FlateDecode"));
    if (!isDct) continue;
    const w = dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber() ?? 0;
    const h = dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber() ?? 0;
    if (!w || !h) continue;
    if (!best || w * h > best.width * best.height) best = { bytes: stream.contents, width: w, height: h };
  }
  if (!best) return null;
  // Does the image plausibly cover the page? An image with the page's
  // proportions is a scan; a small landscape photo on a portrait sheet is not.
  const imgRatio = best.width / best.height;
  const pageRatio = pw / ph;
  const sameShape = Math.abs(imgRatio - pageRatio) / pageRatio < 0.35 || Math.abs(1 / imgRatio - pageRatio) / pageRatio < 0.35;
  const bigEnough = best.width * best.height >= minCoverage * pageArea; // page units are points; scans dwarf this
  // A scan is at least a thousand pixels across; a same-shaped thumbnail is a logo.
  const scanSized = Math.max(best.width, best.height) >= 1000;
  return bigEnough || (sameShape && scanSized) ? best : null;
}

/**
 * A JPEG (raw bytes) → a small JPEG data URL, decoded by the browser with
 * downscaling where it supports it (createImageBitmap resize), never at
 * full size in JavaScript memory.
 */
export async function thumbnailFromJpeg(jpeg: PageJpeg, targetWidth = 180): Promise<string> {
  const blob = new Blob([jpeg.bytes as BlobPart], { type: "image/jpeg" });
  const w = Math.max(1, Math.min(targetWidth, jpeg.width));
  const h = Math.max(1, Math.round((jpeg.height / jpeg.width) * w));
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
  } catch {
    // Safari without resize support: an <img> still decodes natively.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      source = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(source, 0, 0, w, h);
  if ("close" in source) source.close();
  const out = canvas.toDataURL("image/jpeg", 0.7);
  canvas.width = 0;
  canvas.height = 0;
  return out;
}

/** pdf.js will not decode an image bigger than this (pixels) while making previews. */
export const PREVIEW_MAX_IMAGE_PIXELS = 4_000_000;

/**
 * How much drawing a page carries: the compressed size of its content
 * streams, in bytes. A scan's content is a few dozen bytes (`q cm /Im0 Do Q`);
 * an OCR text layer or a title block on top of the image runs to kilobytes;
 * a CAD export to megabytes.
 */
export function pageContentBytes(doc: PDFDocument, pageIndex: number): number {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return 0;
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let total = 0;
  for (const r of refs) {
    const obj = doc.context.lookup(r);
    if (obj instanceof PDFRawStream) total += obj.contents.length;
    else if (obj instanceof PDFStream) total += obj.sizeInBytes();
  }
  return total;
}

/** A page whose drawing is bigger than this is not "just a scan", whatever images it holds. */
export const SCAN_MAX_CONTENT_BYTES = 16 * 1024;

/**
 * The raw JPEG of a page that IS a scan — one big image, next to nothing
 * else drawn — or null. Pages with more on them are rendered instead; the
 * renderer decodes a scan scaled-down, so the cost of a miss is time, not
 * memory.
 */
export function scanPageJpeg(doc: PDFDocument, pageIndex: number): PageJpeg | null {
  if (pageContentBytes(doc, pageIndex) > SCAN_MAX_CONTENT_BYTES) return null;
  return largestPageJpeg(doc, pageIndex);
}
