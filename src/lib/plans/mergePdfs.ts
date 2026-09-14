/**
 * Several PDFs → one plan set.
 *
 * Plan sets often arrive as a folder of one-sheet PDFs (A1.pdf, A2.pdf, …).
 * Picking them all — or the whole folder — combines them into one PDF, in
 * file-name order, that goes through the same triage as a single upload
 * (Erfan, 2026-09-13: "open up a folder and select multiple pages at once").
 *
 * Runs in the browser with pdf-lib, file by file, so a phone never holds
 * more than the source files plus the growing result.
 */
import { PDFDocument } from "pdf-lib";

/** File-name order the way a person reads it: A2 before A10, case ignored. */
export function orderForMerge<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** "Chadron A (12 files).pdf" — the shared start of the names, else the first name. */
export function mergedName(names: string[]): string {
  const stems = names.map((n) => n.replace(/\.pdf$/i, ""));
  let prefix = stems[0] ?? "plan-set";
  for (const s of stems) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i].toLowerCase() === s[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  const base = prefix.replace(/[\s_\-.]+$/, "").trim() || stems[0] || "plan-set";
  return `${base} (${names.length} files).pdf`;
}

/** Every page of every file, in the order given, as one PDF. */
export async function mergePdfs(files: File[], name = mergedName(files.map((f) => f.name))): Promise<File> {
  if (!files.length) throw new Error("No PDFs to combine.");
  if (files.length === 1) return files[0];
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save();
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}
