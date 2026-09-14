import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfs, mergedName, orderForMerge } from "./mergePdfs";

async function onePagePdf(name: string, width: number): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([width, 100]);
  return new File([new Uint8Array(await doc.save())], name, { type: "application/pdf" });
}

describe("orderForMerge", () => {
  it("sorts the way a person reads sheet numbers", () => {
    const names = ["A10.pdf", "a2.pdf", "A1.pdf", "S1.pdf"].map((name) => ({ name }));
    expect(orderForMerge(names).map((f) => f.name)).toEqual(["A1.pdf", "a2.pdf", "A10.pdf", "S1.pdf"]);
  });
});

describe("mergedName", () => {
  it("keeps the shared start of the names", () => {
    expect(mergedName(["Chadron A1.pdf", "Chadron A2.pdf", "Chadron A3.pdf"])).toBe("Chadron A (3 files).pdf");
  });
  it("falls back to the first name when nothing is shared", () => {
    expect(mergedName(["A1.pdf", "S1.pdf"])).toBe("A1 (2 files).pdf");
  });
});

describe("mergePdfs", () => {
  it("puts every page in, in the order given", async () => {
    const a = await onePagePdf("A1.pdf", 300);
    const b = await onePagePdf("A2.pdf", 400);
    const merged = await mergePdfs([a, b]);
    const doc = await PDFDocument.load(await merged.arrayBuffer());
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(300);
    expect(doc.getPage(1).getWidth()).toBe(400);
    expect(merged.name).toBe("A (2 files).pdf");
    expect(merged.type).toBe("application/pdf");
  });
  it("hands a single file back untouched", async () => {
    const a = await onePagePdf("A1.pdf", 300);
    expect(await mergePdfs([a])).toBe(a);
  });
});
