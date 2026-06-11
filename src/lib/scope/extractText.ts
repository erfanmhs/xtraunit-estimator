"use client";

/**
 * Extract the text layer from a PDF, one string per page (browser-side, via
 * PDF.js). Vector/CAD PDFs carry selectable text (schedules, notes, callouts);
 * scanned/image PDFs return little or nothing — the caller treats those pages
 * as "image-only" and flags them for an AI vision read instead.
 */
import { getPdfjs } from "@/lib/pdfClient";

export async function extractPdfText(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({
    data,
    standardFontDataUrl: "/standard_fonts/",
  }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }
  return pages;
}
