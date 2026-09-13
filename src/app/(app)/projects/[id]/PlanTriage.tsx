"use client";

/**
 * Page triage: show every page of a dropped PDF, let the user keep the
 * sheets that matter, record each kept sheet.
 *
 * Two paths, chosen by file size:
 *
 *   CLOUD-FIRST (the normal case, file within the storage upload limit):
 *   the original PDF is uploaded straight from the file picker — the browser
 *   streams it, nothing is read into memory — and the thumbnails are drawn
 *   from that cloud copy through range requests, a page at a time. Saving
 *   only writes rows: each kept sheet points at its page in the stored file.
 *   The phone never holds the whole file, which is what used to make an
 *   iPhone run out of memory and silently reload the tab (Erfan, 2026-09-12,
 *   a plan set picked from Google Drive; the 47-page set before it).
 *
 *   TRIM-IN-BROWSER (file over the upload limit): the old path — read the
 *   file, render thumbnails, rebuild a PDF of only the kept pages, upload
 *   that. Heavy, and warned about on phones, but the only way a 120 MB set
 *   gets in under a 50 MB upload limit.
 *
 * Naming and categorizing happen ONCE, in the takeoff viewer (sheet list →
 * rename / category), not here — so there's no second place to keep in sync.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPdfjs } from "@/lib/pdfClient";
import {
  OPEN_TIMEOUT_MS,
  PAGE_RENDER_TIMEOUT_MS,
  UPLOAD_LIMIT_BYTES,
  explainOpenFailure,
  formatMb,
  sizeVerdict,
  withTimeout,
} from "@/lib/plans/uploadGuards";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PDFDocument as PdfLibDocument } from "pdf-lib";

/** `url` is null when the preview failed — the page itself is still intact and can be kept. */
type Thumb = { page: number; url: string | null };

/** How pdf.js fetches the cloud copy: 1 MB ranges, only what a page needs. */
const RANGE_CHUNK = 1024 * 1024;

export default function PlanTriage({
  projectId,
  file,
  onDone,
  onCancel,
}: {
  projectId: string;
  file: File;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [total, setTotal] = useState(0);
  const [kept, setKept] = useState<Set<number>>(new Set());
  // Cloud-first when the original fits the upload limit; otherwise trim here.
  const cloudFirst = file.size <= UPLOAD_LIMIT_BYTES;
  // The old path's memory guard (only the trim path reads the file into memory).
  const [verdict] = useState(() => {
    if (cloudFirst) return { kind: "ok" as const };
    const phone =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);
    return sizeVerdict(file.size, phone);
  });
  const [phase, setPhase] = useState<"uploading" | "rendering" | "ready" | "saving">(
    verdict.kind === "refuse" ? "ready" : cloudFirst ? "uploading" : "rendering",
  );
  const [error, setError] = useState<string | null>(
    verdict.kind === "refuse" ? verdict.message : null,
  );
  const notice = verdict.kind === "warn" ? verdict.message : null;
  const [failedPages, setFailedPages] = useState<number[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  // The cloud copy's path, once uploaded. Cancelling removes it.
  const uploadedRef = useRef<string | null>(null);
  const userRef = useRef<string | null>(null);

  useEffect(() => {
    if (verdict.kind === "refuse") return;

    // This effect can run twice for one file (React's development double
    // mount). Each run owns its own document and stands down the moment it
    // is cleaned up, so the survivor is the only one that touches state.
    let cancelled = false;
    let doc: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
        const pdfjs = await withTimeout(getPdfjs(), OPEN_TIMEOUT_MS, "Loading the PDF reader");
        let pdf: PDFDocumentProxy;

        if (cloudFirst) {
          // 1. Upload the original as-is. The browser streams the File; the
          //    page never holds its bytes.
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) throw new Error("Your session expired. Please sign in again.");
          userRef.current = user.id;
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${user.id}/${projectId}/${Date.now()}-${safeName}`;
          setProgress(`Uploading ${formatMb(file.size)}…`);
          const { error: upErr } = await supabase.storage
            .from("plans")
            .upload(path, file, { contentType: "application/pdf" });
          if (upErr) {
            if (/exceeded the maximum allowed size|payload too large|413/i.test(upErr.message))
              throw new Error(
                `This PDF is ${formatMb(file.size)}, over the storage upload limit. Drop pages in Bluebeam first, or raise the limit in Supabase (Storage → Settings).`,
              );
            throw upErr;
          }
          if (cancelled) {
            await supabase.storage.from("plans").remove([path]);
            return;
          }
          uploadedRef.current = path;
          setProgress(null);
          setPhase("rendering");

          // 2. Open the cloud copy by range requests: pdf.js pulls only the
          //    bytes each page needs, so the phone never holds the file.
          const { data: signed, error: sErr } = await supabase.storage
            .from("plans")
            .createSignedUrl(path, 60 * 30);
          if (sErr || !signed) throw sErr ?? new Error("Could not open the uploaded file.");
          const task = pdfjs.getDocument({
            url: signed.signedUrl,
            rangeChunkSize: RANGE_CHUNK,
            disableAutoFetch: true,
            disableStream: false,
            standardFontDataUrl: "/standard_fonts/",
          });
          pdf = await withTimeout(task.promise, OPEN_TIMEOUT_MS, "Opening the PDF", () => {
            void task.destroy();
          });
        } else {
          const task = pdfjs.getDocument({
            data: await file.arrayBuffer(),
            standardFontDataUrl: "/standard_fonts/",
          });
          pdf = await withTimeout(task.promise, OPEN_TIMEOUT_MS, "Opening the PDF", () => {
            void task.destroy();
          });
        }
        doc = pdf;
        if (cancelled) return;
        setTotal(pdf.numPages);

        const failed: number[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          // One bad page (a corrupt scan, a 200 MB embedded image, a render
          // that never returns) must not take the other 46 with it. It gets a
          // placeholder and can still be kept.
          let url: string | null = null;
          let page: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
          try {
            page = await withTimeout(pdf.getPage(n), PAGE_RENDER_TIMEOUT_MS, `Page ${n}`);
            const base = page.getViewport({ scale: 1 });
            const scale = 180 / base.width;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d")!;
            const render = page.render({ canvasContext: ctx, viewport });
            await withTimeout(render.promise, PAGE_RENDER_TIMEOUT_MS, `Page ${n}`, () => {
              render.cancel();
            });
            url = canvas.toDataURL("image/jpeg", 0.7);
            canvas.width = 0; // release the bitmap now, not at the next GC
            canvas.height = 0;
          } catch {
            failed.push(n);
          } finally {
            // Drop this page's decoded images before moving on — pdf.js keeps
            // them cached per page, and on a scanned set that cache IS the
            // memory problem.
            page?.cleanup();
          }
          if (cancelled) return;
          setThumbs((prev) => [...prev, { page: n, url }]);
        }
        setFailedPages(failed);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(explainOpenFailure(e));
        setPhase("ready");
      } finally {
        // The worker holds the parsed document; free it before the save step
        // (the trim path reads the file again), so the two never overlap.
        void doc?.destroy();
        doc = null;
      }
    })();

    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [file, verdict, cloudFirst, projectId, supabase]);

  function toggle(page: number) {
    setKept((prev) => {
      const s = new Set(prev);
      if (s.has(page)) s.delete(page);
      else s.add(page);
      return s;
    });
  }

  /** Cancel: the cloud copy must not linger with no sheet records. */
  async function cancel() {
    const path = uploadedRef.current;
    uploadedRef.current = null;
    if (path) await supabase.storage.from("plans").remove([path]);
    onCancel();
  }

  async function save() {
    if (kept.size === 0) return;
    setPhase("saving");
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session expired. Please sign in again.");
      const keptPages = [...kept].sort((a, b) => a - b); // 1-based, in the file the user dropped

      let path: string;
      let sizeBytes: number;
      // page_number = the page's index in the STORED file (what the viewer
      // opens); original_page_number = its index in the file the user dropped.
      let rows: { page_number: number; original_page_number: number }[];

      if (cloudFirst && uploadedRef.current) {
        // The stored file IS the original: every kept sheet keeps its number.
        path = uploadedRef.current;
        sizeBytes = file.size;
        rows = keptPages.map((p) => ({ page_number: p, original_page_number: p }));
      } else {
        // Trim path: rebuild a PDF of only the kept pages, renumbered 1..n.
        const { PDFDocument } = await import("pdf-lib");
        let src: PdfLibDocument;
        try {
          src = await withTimeout(
            PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }),
            OPEN_TIMEOUT_MS,
            "Reading the PDF",
          );
        } catch (e) {
          throw new Error(explainOpenFailure(e));
        }
        const out = await PDFDocument.create();
        const copied = await out.copyPages(
          src,
          keptPages.map((p) => p - 1),
        );
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        const trimMb = bytes.length / (1024 * 1024);
        const origMb = file.size / (1024 * 1024);
        setProgress(
          `Uploading ${trimMb.toFixed(1)} MB` +
            (origMb > trimMb + 0.1
              ? ` — trimmed from ${origMb.toFixed(1)} MB (${keptPages.length} of ${total} pages)`
              : "") +
            "…",
        );
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        path = `${user.id}/${projectId}/${Date.now()}-${safeName}`;
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const { error: upErr } = await supabase.storage
          .from("plans")
          .upload(path, blob, { contentType: "application/pdf" });
        if (upErr) {
          const mb = (bytes.length / (1024 * 1024)).toFixed(1);
          if (/exceeded the maximum allowed size|payload too large|413/i.test(upErr.message)) {
            throw new Error(
              `This trimmed plan set is ${mb} MB, over your storage upload limit. In Supabase, raise the "plans" bucket file-size limit (Storage → Buckets → plans → Edit) and the project upload limit (Storage → Settings). Or keep fewer / lighter pages.`,
            );
          }
          throw upErr;
        }
        sizeBytes = bytes.length;
        rows = keptPages.map((orig, idx) => ({ page_number: idx + 1, original_page_number: orig }));
      }

      const { data: pf, error: pfErr } = await supabase
        .from("plan_files")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          file_name: file.name,
          storage_path: path,
          size_bytes: sizeBytes,
          mime_type: "application/pdf",
        })
        .select("id")
        .single();
      if (pfErr) throw pfErr;

      const { error: shErr } = await supabase.from("sheets").insert(
        rows.map((r) => ({
          project_id: projectId,
          plan_file_id: pf.id,
          owner_id: user.id,
          ...r,
        })),
      );
      if (shErr) {
        // Roll back so we never leave a file with no sheet records.
        await supabase.from("plan_files").delete().eq("id", pf.id);
        await supabase.storage.from("plans").remove([path]);
        uploadedRef.current = null;
        throw shErr;
      }
      uploadedRef.current = null; // now owned by the plan_files row

      router.refresh();
      onDone();
    } catch (e) {
      setError("Save failed: " + (e instanceof Error ? e.message : String(e)));
      setPhase("ready");
    }
  }

  const uploading = phase === "uploading";
  const rendering = phase === "rendering";
  const saving = phase === "saving";

  return (
    <section className="flex flex-col gap-4 rounded-xl glass p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg text-foreground">
            Select the sheets to keep
          </h2>
          <p className="text-sm text-muted">
            {(saving || uploading) && progress
              ? progress
              : uploading
                ? "Uploading…"
                : rendering
                  ? `Loading thumbnails… ${thumbs.length}/${total || "?"}`
                  : `${kept.size} of ${total} pages kept — ${file.name}`}
          </p>
          {!rendering && !saving && !uploading ? (
            <p className="mt-0.5 text-xs text-muted/70">
              Name and categorize the kept sheets in the viewer next — one place, once.
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-soft"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      ) : null}
      {failedPages.length > 0 ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-foreground">
          {failedPages.length === 1
            ? `Page ${failedPages[0]} couldn't be previewed`
            : `${failedPages.length} pages couldn't be previewed (${failedPages.slice(0, 8).join(", ")}${
                failedPages.length > 8 ? "…" : ""
              })`}
          . You can still keep {failedPages.length === 1 ? "it" : "them"} — the page itself is
          intact and will be saved as-is.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {thumbs.map((t) => {
          const on = kept.has(t.page);
          return (
            <div key={t.page} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => toggle(t.page)}
                disabled={saving}
                className={`relative overflow-hidden rounded-md border bg-white transition-all ${
                  on
                    ? "border-brand ring-2 ring-brand"
                    : "border-border opacity-60 hover:opacity-100"
                }`}
              >
                {t.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.url} alt={`Page ${t.page}`} className="w-full" />
                ) : (
                  <span className="flex aspect-[4/3] w-full items-center justify-center bg-muted/20 px-2 text-center text-[11px] text-muted">
                    No preview
                  </span>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                  {t.page}
                </span>
                {on ? (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-xs text-white">
                    ✓
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions after the sheets, sticky to the bottom: Save is always in
          thumb reach on a phone, the count always visible. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-1 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-6 py-3 backdrop-blur pb-safe">
        <span className="text-sm text-muted" aria-live="polite">
          {kept.size === 0
            ? "No sheets picked yet"
            : `${kept.size} of ${total} selected`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKept(new Set())}
            disabled={saving || kept.size === 0}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-40"
          >
            Deselect all
          </button>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || rendering || uploading || kept.size === 0}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save ${kept.size} page${kept.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
