/**
 * Browser-side PDF.js loader.
 *
 * Loads pdfjs-dist (pinned to the stable 4.x — do NOT bump to 6.x, its render
 * hangs) and wires up a real module worker once. Only import this from client
 * components.
 */
import type * as PdfjsNS from "pdfjs-dist";

let cached: typeof PdfjsNS | null = null;

export async function getPdfjs() {
  if (cached) return cached;
  const pdfjs = await import("pdfjs-dist");
  const worker = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  cached = pdfjs;
  return pdfjs;
}
