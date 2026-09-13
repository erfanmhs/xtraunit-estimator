/**
 * Page thumbnails for a drawn (vector) sheet, on a phone's budget.
 *
 * pdf.js is the wrong tool for this job. To draw a 180 px thumbnail of a
 * CAD export it turns every path on the page into JavaScript objects —
 * 250,000 operators for one floor plan — and ships them from its worker to
 * the page. Measured on the Santa Clara set (25 MB, 31 sheets): the browser
 * process climbed from 176 MB to 903 MB while three heavy sheets went by.
 * An iPhone kills a tab well before that; Erfan saw the page reset and
 * reload mid-load, from Google Drive and from Files alike.
 *
 * PDFium — Chrome's own PDF engine, compiled to WebAssembly — keeps the page
 * in native memory and hands back only the finished pixels. Same set, same
 * thumbnails: under 5 s and a 370 MB peak, most of it the file itself.
 * It runs in a worker, so the upload bar keeps moving while pages render.
 *
 * pdf.js stays as the fallback for a browser without WebAssembly, capped so
 * it never decodes a scan by accident.
 */
import type { PDFiumWorkerClient, PDFiumWorkerDocument } from "@hyzyla/pdfium/worker";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { getPdfjs } from "@/lib/pdfClient";
import { PREVIEW_MAX_IMAGE_PIXELS } from "@/lib/plans/previews";
import { withTimeout } from "@/lib/plans/uploadGuards";

export type Thumbnailer = {
  engine: "pdfium" | "pdfjs";
  numPages: number;
  /** A JPEG data URL of page `n` (1-based) at `width` px. */
  render(n: number, width: number): Promise<string>;
  /** Abandon whatever is in flight and start clean; the next render is on a fresh engine. */
  reset(): Promise<void>;
  close(): void;
};

/** The thumbnail pixels → a small JPEG data URL, with the canvas released right away. */
function toJpeg(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  draw(ctx);
  const out = canvas.toDataURL("image/jpeg", 0.7);
  canvas.width = 0;
  canvas.height = 0;
  return out;
}

/**
 * Stop a PDFium worker for good. `destroy()` asks politely and waits for an
 * answer — which never comes from a worker stuck in a render — so give it a
 * moment, then pull the plug on the channel underneath (the client keeps it
 * protected; there is no public hard stop).
 */
async function kill(client: PDFiumWorkerClient): Promise<void> {
  const channel = (client as unknown as { channel: { terminate(): void } }).channel;
  await Promise.race([client.destroy().catch(() => {}), new Promise<void>((r) => setTimeout(r, 500))]);
  channel.terminate();
}

async function openPdfium(bytes: ArrayBuffer): Promise<Thumbnailer> {
  const { PDFiumWorkerClient } = await import("@hyzyla/pdfium/worker");
  // The worker is a blob: module (CSP: worker-src blob:) and compiles the
  // engine from this URL (CSP: script-src 'wasm-unsafe-eval'). The bundler
  // rewrites the asset reference to a root-relative path; a blob: worker has
  // no origin to resolve that against, so make it absolute here.
  const wasmUrl = new URL(String(new URL("@hyzyla/pdfium/pdfium.wasm", import.meta.url)), window.location.origin).href;
  let client: PDFiumWorkerClient | null = null;
  let doc: PDFiumWorkerDocument | null = null;
  const open = async () => {
    client = await PDFiumWorkerClient.spawn({ wasmUrl });
    // loadDocument transfers the buffer to the worker: hand it a copy so the
    // caller's bytes (pdf-lib's views into them) stay intact.
    doc = await client.loadDocument(new Uint8Array(bytes.slice(0)));
  };
  const close = () => {
    if (client) void kill(client); // frees the worker's copy of the file and the engine with it
    client = null;
    doc = null;
  };
  await open();
  const numPages = await doc!.getPageCount();
  return {
    engine: "pdfium",
    numPages,
    async render(n, width) {
      if (!doc) await open();
      const page = await doc!.getPage(n - 1);
      const { originalWidth, originalHeight } = await page.getOriginalSize();
      const w = Math.max(1, Math.min(width, Math.floor(originalWidth)));
      const h = Math.max(1, Math.round((originalHeight / originalWidth) * w));
      const r = await page.render({ width: w, height: h, scale: 1 });
      // REVERSE_BYTE_ORDER is set in the engine: the bitmap is already RGBA.
      return toJpeg(
        (ctx) => {
          const img = ctx.createImageData(r.width, r.height);
          img.data.set(r.data.subarray(0, img.data.length));
          ctx.putImageData(img, 0, 0);
        },
        r.width,
        r.height,
      );
    },
    async reset() {
      // A render that hangs cannot be cancelled inside the engine; the worker can.
      close();
      await open();
    },
    close,
  };
}

async function openPdfjs(bytes: ArrayBuffer): Promise<Thumbnailer> {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    maxImageSize: PREVIEW_MAX_IMAGE_PIXELS,
    standardFontDataUrl: "/standard_fonts/",
  });
  const pdf = await task.promise;
  let inFlight: RenderTask | null = null;
  return {
    engine: "pdfjs",
    numPages: pdf.numPages,
    async render(n, width) {
      const page: PDFPageProxy = await pdf.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        inFlight = page.render({ canvasContext: ctx, viewport });
        await inFlight.promise;
        const out = canvas.toDataURL("image/jpeg", 0.7);
        canvas.width = 0;
        canvas.height = 0;
        return out;
      } finally {
        inFlight = null;
        page.cleanup(); // drop this page's decoded images before moving on
      }
    },
    async reset() {
      inFlight?.cancel();
      inFlight = null;
    },
    close() {
      inFlight?.cancel();
      void pdf.destroy();
    },
  };
}

/** A browser that cannot start the engine in this long gets pdf.js instead. */
const PDFIUM_START_TIMEOUT_MS = 20_000;

/** PDFium when the browser can run it; pdf.js otherwise. */
export async function openThumbnailer(bytes: ArrayBuffer): Promise<Thumbnailer> {
  if (typeof WebAssembly !== "undefined") {
    try {
      return await withTimeout(openPdfium(bytes), PDFIUM_START_TIMEOUT_MS, "Starting the PDF engine");
    } catch (e) {
      console.warn("PDFium unavailable, previews fall back to pdf.js:", e);
    }
  }
  return openPdfjs(bytes);
}
