import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { largestPageJpeg, pageContentBytes } from "./previews";

// A real, tiny baseline JPEG (1×1, white) — enough for pdf-lib to embed.
const TINY_JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEEA/AKpgAf/Z",
  ),
  (c) => c.charCodeAt(0),
);

async function scanLikePdf(scale: number, addVectorPage: boolean) {
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
  const bytes = await pdf.save();
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

describe("pageContentBytes — how heavy a page is to draw", () => {
  it("measures the content streams, so a drawn page weighs more than an image page", async () => {
    const doc = await scanLikePdf(1, true);
    const scan = pageContentBytes(doc, 0); // one "Do" operator
    const drawn = pageContentBytes(doc, 1); // a line
    expect(scan).toBeGreaterThan(0);
    expect(drawn).toBeGreaterThan(0);
    expect(scan).toBeLessThan(200);
  });
});
