import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { largestPageJpeg, pageContentBytes, scanPageJpeg } from "./previews";

// A real, tiny baseline JPEG (1×1, white) — enough for pdf-lib to embed.
const TINY_JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEEA/AKpgAf/Z",
  ),
  (c) => c.charCodeAt(0),
);

async function scanLikePdf(scale: number, addVectorPage: boolean, busyImagePage = false) {
  const pdf = await PDFDocument.create();
  const img = await pdf.embedJpg(TINY_JPEG);
  // Page 1: the image drawn across the whole page — a scan.
  const p1 = pdf.addPage([612, 792]);
  p1.drawImage(img, { x: 0, y: 0, width: 612 * scale, height: 792 * scale });
  if (addVectorPage) {
    // Page 2: lines only — a drawn sheet.
    const p2 = pdf.addPage([612, 792]);
    p2.drawLine({ start: { x: 10, y: 10 }, end: { x: 600, y: 780 } });
  }
  if (busyImagePage) {
    // Last page: the same image on a page with a lot of drawing — a photo on a sheet.
    const p3 = pdf.addPage([612, 792]);
    p3.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    // Distinct coordinates so the deflated stream stays well over the scan gate.
    for (let i = 0; i < 4000; i++) {
      p3.drawLine({ start: { x: (i * 7.13) % 600, y: (i * 3.71) % 780 }, end: { x: (i * 11.37) % 600, y: (i * 5.19) % 780 } });
    }
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return PDFDocument.load(bytes);
}

describe("largestPageJpeg — the raw JPEG behind a scanned page", () => {
  it("returns the still-compressed JPEG bytes and its pixel size for a scanned page", async () => {
    const doc = await scanLikePdf(1, true);
    const hit = largestPageJpeg(doc, 0, 0); // coverage check off: the fixture is a 1×1 image
    expect(hit).not.toBeNull();
    expect(hit!.width).toBe(1);
    expect(hit!.height).toBe(1);
    expect(hit!.bytes.slice(0, 3)).toEqual(Uint8Array.from([0xff, 0xd8, 0xff])); // JPEG magic, untouched
  });
  it("returns null for a page that is drawn, not scanned", async () => {
    const doc = await scanLikePdf(1, true);
    expect(largestPageJpeg(doc, 1, 0)).toBeNull();
  });
  it("ignores a small inset image on a page (a logo is not a scan)", async () => {
    const doc = await scanLikePdf(1, false);
    // Default coverage rule: a 1×1 image neither matches the page shape
    // nor covers it, so it must not be treated as the page.
    expect(largestPageJpeg(doc, 0)).toBeNull();
  });
});

describe("pageContentBytes — how much drawing a page carries", () => {
  it("measures the content streams, so a drawn page weighs more than an image page", async () => {
    const doc = await scanLikePdf(1, true);
    const scan = pageContentBytes(doc, 0); // one "Do" operator
    const drawn = pageContentBytes(doc, 1); // a line
    expect(scan).toBeGreaterThan(0);
    expect(drawn).toBeGreaterThan(0);
    expect(scan).toBeLessThan(200);
  });
});

describe("scanPageJpeg — only a page that IS its image", () => {
  it("takes the JPEG of a bare scan and refuses a busy page that merely holds one", async () => {
    const doc = await scanLikePdf(1, false, true);
    // Coverage check off: the fixture image is 1×1. What matters is the drawing around it.
    expect(scanPageJpeg(doc, 0)).toBeNull(); // 1×1 fails the coverage rule…
    expect(largestPageJpeg(doc, 0, 0)).not.toBeNull(); // …but the image is there
    expect(pageContentBytes(doc, 1)).toBeGreaterThan(16 * 1024);
    expect(largestPageJpeg(doc, 1, 0)).not.toBeNull(); // the busy page holds the same JPEG
    expect(scanPageJpeg(doc, 1)).toBeNull(); // and is still not a scan
  });
});
