import { describe, expect, it } from "vitest";
import { fitWithin, photoFileName } from "./photo";

describe("fitWithin", () => {
  it("shrinks the long edge to the limit and keeps the aspect ratio", () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ w: 2000, h: 1500, scale: 2000 / 4032 });
    expect(fitWithin(3024, 4032, 2000)).toEqual({ w: 1500, h: 2000, scale: 2000 / 4032 });
  });
  it("never upscales a small image", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ w: 800, h: 600, scale: 1 });
  });
  it("copes with a zero-size image", () => {
    expect(fitWithin(0, 0, 2000)).toEqual({ w: 0, h: 0, scale: 1 });
  });
});

describe("photoFileName", () => {
  it("is sortable and storage-safe", () => {
    const d = new Date(2026, 8, 12, 14, 5); // 12 Sep 2026 14:05 local
    expect(photoFileName("sheet-photo", "pdf", d)).toBe("sheet-photo 2026-09-12 14-05.pdf");
  });
});
