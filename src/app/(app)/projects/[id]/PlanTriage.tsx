"use client";

/**
 * Page triage: show every page of a dropped PDF, let the user keep the
 * sheets that matter, record each kept sheet.
 *
 * Two things happen at once the moment a file is picked:
 *
 *   THE UPLOAD — the original PDF, as-is, streamed from the file picker to
 *   storage with a real progress bar (an XHR, because the storage client
 *   gives no progress events). Nothing is rebuilt; what you dropped is what
 *   is stored.
 *
 *   THE PREVIEWS — from the same File, cheapest reader first: a scanned
 *   page is one JPEG, handed straight to the browser's decoder; a drawn page
 *   is rendered by PDFium in a worker (see lib/plans/thumbnailers.ts for why
 *   not pdf.js — it was the iPhone crash). Previews appear while the upload
 *   is still running, so a 30 MB set over cellular is never a blank box
 *   with a spinner (Erfan, 2026-09-13).
 *
 * Saving writes rows only: each kept sheet points at its own page number in
 * the stored file (page_number = original_page_number), so the viewer, the
 * prepare step and the export need no change. Cancel aborts the upload and
 * removes anything that already landed.
 *
 * A file over the storage upload limit (50 MB on the free plan) still takes
 * the old trim-in-browser path: rebuild a PDF of the kept pages, upload
 * that. Heavy, and warned about on phones, but the only way in.
 *
 * Naming and categorizing happen ONCE, in the takeoff viewer (sheet list →
 * rename / category), not here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  OPEN_TIMEOUT_MS,
  PAGE_RENDER_TIMEOUT_MS,
  UPLOAD_LIMIT_BYTES,
  explainOpenFailure,
  formatMb,
  sizeVerdict,
  withTimeout,
} from "@/lib/plans/uploadGuards";
import type { PDFDocument as PdfLibDocument } from "pdf-lib";
import { scanPageJpeg, thumbnailFromJpeg } from "@/lib/plans/previews";
import { openThumbnailer, type Thumbnailer } from "@/lib/plans/thumbnailers";

/** `url` is null when the preview failed — the page itself is still intact and can be kept. */
type Thumb = { page: number; url: string | null };

type Upload =
  | { state: "idle" }
  | { state: "running"; sent: number; total: number; startedAt: number }
  | { state: "done"; path: string; bytes: number }
  | { state: "failed"; message: string };

/**
 * Upload a File to Supabase Storage with progress. The JS client wraps
 * fetch, which reports nothing; this is the same REST call with an XHR.
 */
function uploadWithProgress(opts: {
  path: string;
  file: Blob;
  token: string;
  onProgress: (sent: number, total: number) => void;
}): { promise: Promise<void>; abort: () => void } {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("POST", `${base}/storage/v1/object/plans/${opts.path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${opts.token}`);
    xhr.setRequestHeader("apikey", anon);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status}).`;
      try {
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        msg = j.message || j.error || msg;
      } catch {}
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.send(opts.file);
  });
  return { promise, abort: () => xhr.abort() };
}

function eta(sent: number, total: number, startedAt: number): string {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (sent <= 0 || elapsed < 2) return "";
  const rate = sent / elapsed; // bytes/s
  const left = (total - sent) / rate;
  if (!isFinite(left) || left < 1) return "";
  return left < 60 ? `about ${Math.ceil(left)} s left` : `about ${Math.ceil(left / 60)} min left`;
}

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
  const [rendering, setRendering] = useState(true);
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [failedPages, setFailedPages] = useState<number[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  // Cloud-first when the original fits the upload limit; otherwise trim here.
  const cloudFirst = file.size <= UPLOAD_LIMIT_BYTES;
  // The old path's memory guard (the trim path reads the file a second time).
  const [verdict] = useState(() => {
    if (cloudFirst) return { kind: "ok" as const };
    const phone =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);
    return sizeVerdict(file.size, phone);
  });
  const notice = verdict.kind === "warn" ? verdict.message : null;
  const abortRef = useRef<(() => void) | null>(null);
  const uploadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (verdict.kind === "refuse") {
      setError(verdict.message);
      setRendering(false);
    }
  }, [verdict]);

  // ── The upload, straight from the picker ──────────────────────────────────
  useEffect(() => {
    if (!cloudFirst) return;
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setUpload({ state: "failed", message: "Your session expired. Please sign in again." });
        return;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${session.user.id}/${projectId}/${Date.now()}-${safeName}`;
      const startedAt = Date.now();
      setUpload({ state: "running", sent: 0, total: file.size, startedAt });
      const u = uploadWithProgress({
        path,
        file,
        token: session.access_token,
        onProgress: (sent, tot) => {
          if (!cancelled) setUpload({ state: "running", sent, total: tot, startedAt });
        },
      });
      abortRef.current = u.abort;
      try {
        await u.promise;
        if (cancelled) {
          await supabase.storage.from("plans").remove([path]);
          return;
        }
        uploadedRef.current = path;
        setUpload({ state: "done", path, bytes: file.size });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Upload failed.";
        setUpload({
          state: "failed",
          message: /exceeded the maximum allowed size|payload too large|413/i.test(msg)
            ? `This PDF is ${formatMb(file.size)}, over the storage upload limit. Drop pages in Bluebeam first, or raise the limit in Supabase (Storage → Settings).`
            : msg,
        });
      } finally {
        abortRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.();
    };
  }, [file, cloudFirst, projectId, supabase]);

  // ── The previews, from the same File ──────────────────────────────────────
  // pdf-lib opens the file on the main thread (structure only, no decoding)
  // to find the scans: a page that is one big JPEG goes to the browser's own
  // decoder, which scales as it decodes. Every other page is drawn by the
  // thumbnailer (PDFium in a worker; pdf.js only as a fallback).
  useEffect(() => {
    if (verdict.kind === "refuse") return;
    // Can run twice for one file (React's development double mount). Each
    // run owns its own engine and stands down when cleaned up.
    let cancelled = false;
    let engine: Thumbnailer | null = null;
    (async () => {
      try {
        const bytes = await file.arrayBuffer();
        const { PDFDocument } = await import("pdf-lib");
        let lib: PdfLibDocument | null = null;
        try {
          lib = await withTimeout(
            PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }),
            OPEN_TIMEOUT_MS,
            "Reading the PDF",
          );
        } catch {
          lib = null; // a file pdf-lib can't parse still gets drawn previews
        }
        if (cancelled) return;
        const pageCount = lib?.getPageCount() ?? 0;
        if (pageCount) setTotal(pageCount);

        engine = await withTimeout(openThumbnailer(bytes), OPEN_TIMEOUT_MS, "Opening the PDF");
        if (cancelled) return;
        setTotal(engine.numPages);

        const failed: number[] = [];
        for (let n = 1; n <= engine.numPages; n++) {
          if (cancelled) return;
          let url: string | null = null;
          try {
            // A scan: the browser makes the thumbnail from the raw JPEG.
            const jpeg = lib && n <= pageCount ? scanPageJpeg(lib, n - 1) : null;
            url = jpeg
              ? await withTimeout(thumbnailFromJpeg(jpeg, 180), PAGE_RENDER_TIMEOUT_MS, `Page ${n}`)
              : await withTimeout(engine.render(n, 180), PAGE_RENDER_TIMEOUT_MS, `Page ${n}`, () => {
                  void engine?.reset(); // a stuck page must not hold the next ones hostage
                });
          } catch {
            failed.push(n);
          }
          if (cancelled) return;
          setThumbs((prev) => [...prev, { page: n, url }]);
        }
        setFailedPages(failed);
      } catch (e) {
        if (cancelled) return;
        setError(explainOpenFailure(e));
      } finally {
        setRendering(false);
        // Free the engine's copy of the file as soon as the previews exist.
        engine?.close();
        engine = null;
      }
    })();
    return () => {
      cancelled = true;
      engine?.close();
    };
  }, [file, verdict]);

  function toggle(page: number) {
    setKept((prev) => {
      const s = new Set(prev);
      if (s.has(page)) s.delete(page);
      else s.add(page);
      return s;
    });
  }

  /** Cancel: abort a running upload; remove a finished one. */
  async function cancel() {
    abortRef.current?.();
    const path = uploadedRef.current;
    uploadedRef.current = null;
    if (path) await supabase.storage.from("plans").remove([path]);
    onCancel();
  }

  async function save() {
    if (kept.size === 0) return;
    setSaving(true);
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

      if (cloudFirst) {
        if (upload.state !== "done") throw new Error("The upload hasn't finished yet.");
        path = upload.path;
        sizeBytes = upload.bytes;
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
        setProgress(`Uploading ${formatMb(bytes.length)} (${keptPages.length} of ${total} pages)…`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        path = `${user.id}/${projectId}/${Date.now()}-${safeName}`;
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const { error: upErr } = await supabase.storage
          .from("plans")
          .upload(path, blob, { contentType: "application/pdf" });
        if (upErr) {
          if (/exceeded the maximum allowed size|payload too large|413/i.test(upErr.message)) {
            throw new Error(
              `This trimmed plan set is ${formatMb(bytes.length)}, over your storage upload limit. Keep fewer pages, or raise the limit in Supabase (Storage → Settings).`,
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
        rows.map((r) => ({ project_id: projectId, plan_file_id: pf.id, owner_id: user.id, ...r })),
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
      setSaving(false);
    }
  }

  const pct =
    upload.state === "running" && upload.total > 0 ? Math.min(100, Math.round((upload.sent / upload.total) * 100)) : null;
  const uploadLine =
    upload.state === "running"
      ? `Uploading ${formatMb(upload.sent)} of ${formatMb(upload.total)} · ${pct}% ${eta(upload.sent, upload.total, upload.startedAt)}`.trim()
      : upload.state === "done"
        ? `Uploaded ${formatMb(upload.bytes)} ✓`
        : upload.state === "failed"
          ? upload.message
          : null;
  const canSave = kept.size > 0 && !saving && !rendering && (!cloudFirst || upload.state === "done");

  return (
    <section className="flex flex-col gap-4 rounded-xl glass p-6">
      <div>
        <h2 className="font-heading text-lg text-foreground">Select the sheets to keep</h2>
        <p className="text-sm text-muted">
          {saving && progress
            ? progress
            : rendering
              ? `Loading pages… ${thumbs.length}/${total || "?"} — ${file.name}`
              : `${kept.size} of ${total} pages kept — ${file.name}`}
        </p>
        {!rendering && !saving ? (
          <p className="mt-0.5 text-xs text-muted/70">
            Name and categorize the kept sheets in the viewer next — one place, once.
          </p>
        ) : null}
      </div>

      {/* The upload, in the open: a bar, the MB, the time left. */}
      {cloudFirst && upload.state !== "idle" ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border px-3 py-2 text-sm ${
            upload.state === "failed"
              ? "border-brand/40 bg-brand/10 text-brand-soft"
              : "border-border bg-background/60 text-foreground"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{uploadLine}</span>
            {upload.state === "running" ? (
              <span className="text-xs text-muted">you can pick sheets while it uploads</span>
            ) : null}
          </div>
          {upload.state === "running" ? (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${pct ?? 0}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-foreground">{notice}</p>
      ) : null}
      {failedPages.length > 0 ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-foreground">
          {failedPages.length === 1
            ? `Page ${failedPages[0]} couldn't be previewed`
            : `${failedPages.length} pages couldn't be previewed (${failedPages.slice(0, 8).join(", ")}${failedPages.length > 8 ? "…" : ""})`}
          . You can still keep {failedPages.length === 1 ? "it" : "them"} — the page itself is intact and will be saved as-is.
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
                  on ? "border-brand ring-2 ring-brand" : "border-border opacity-60 hover:opacity-100"
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
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{t.page}</span>
                {on ? (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-xs text-white">✓</span>
                ) : null}
              </button>
            </div>
          );
        })}
        {rendering && thumbs.length === 0
          ? // Placeholders so the box is never empty while the first page renders.
            [0, 1, 2, 3].map((i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-md border border-border bg-muted/10" />)
          : null}
      </div>

      {/* Actions after the sheets, sticky to the bottom: Save always in thumb reach. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-1 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-6 py-3 backdrop-blur pb-safe">
        <span className="text-sm text-muted" aria-live="polite">
          {kept.size === 0 ? "No sheets picked yet" : `${kept.size} of ${total} selected`}
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
            disabled={!canSave}
            title={cloudFirst && upload.state === "running" ? "Waiting for the upload to finish" : undefined}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : cloudFirst && upload.state === "running" && kept.size > 0
                ? `Uploading… ${pct ?? 0}%`
                : `Save ${kept.size} page${kept.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
