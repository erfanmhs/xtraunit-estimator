"use client";

/**
 * Plans section for a project.
 *
 * Dropping a PDF opens the triage screen (pick the sheets to keep) — only the
 * trimmed result is uploaded. Below, the list of saved plan files with View
 * (short-lived signed URL) and Delete.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PlanTriage from "./PlanTriage";
import type { PlanFile } from "@/types";
import Caret from "@/components/Caret";
import { sizeVerdict } from "@/lib/plans/uploadGuards";
import { SHEET_MAX_EDGE, normalizePhoto, photoFileName, photosToPdf } from "@/lib/photo";
import { mergePdfs, orderForMerge } from "@/lib/plans/mergePdfs";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PlanManager({
  projectId,
  files,
}: {
  projectId: string;
  files: PlanFile[];
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const [triageFile, setTriageFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useState(files.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [preparing, setPreparing] = useState<string | null>(null);

  // Photos of sheets — from the phone's library, the camera roll (HEIC
  // included) or a scan — become one PDF, a page per photo, and go through
  // the same triage as an uploaded set. Scale is set in the viewer with
  // Calibrate, like any scan.
  const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name);
  const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

  async function photosPdf(raws: File[]): Promise<File> {
    const jpegs: File[] = [];
    for (const [i, raw] of raws.entries()) jpegs.push(await normalizePhoto(raw, SHEET_MAX_EDGE, `sheet-${i + 1}.jpg`));
    return photosToPdf(jpegs, photoFileName(raws.length === 1 ? "sheet-photo" : "sheet-photos", "pdf"));
  }

  // Several files become ONE plan set before triage: PDFs in file-name order
  // (a folder of one-sheet PDFs — A1, A2, … — is how many sets arrive), then
  // any photos, a page each. The combined weight is checked first, so a phone
  // is told before it tries to hold a set it can't.
  async function combine(pdfs: File[], images: File[]) {
    setError(null);
    const total = [...pdfs, ...images].reduce((n, f) => n + f.size, 0);
    const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
    const verdict = sizeVerdict(total, phone);
    if (verdict.kind === "refuse") return setError(verdict.message);
    const n = pdfs.length + images.length;
    setPreparing(
      pdfs.length && images.length
        ? `Combining ${n} files into one set…`
        : pdfs.length
          ? `Combining ${pdfs.length} PDFs into one set…`
          : "Preparing your photos…",
    );
    try {
      const parts = orderForMerge(pdfs);
      if (images.length) parts.push(await photosPdf(orderForMerge(images)));
      pickFile(await mergePdfs(parts));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read those files.");
    } finally {
      setPreparing(null);
    }
  }

  // One control takes everything: a PDF plan set, several PDFs, a whole
  // folder, or one or more photos.
  function pick(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    setError(null);
    const pdfs = files.filter(isPdf);
    const images = files.filter((f) => !isPdf(f) && isImage(f));
    if (pdfs.length === 1 && files.length === 1) return pickFile(pdfs[0]);
    if (!pdfs.length && !images.length)
      return setError("Upload a PDF plan set, or photos of sheets (JPG, PNG, HEIC). Other files can't be measured.");
    void combine(pdfs, images);
  }

  function pickFile(file: File) {
    setError(null);
    if (file.type && file.type !== "application/pdf") {
      setError("Only PDF plan sets are supported.");
      return;
    }
    // Too big to survive the browser at all? Say so here, before a screen
    // opens that would only die halfway through.
    const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
    const verdict = sizeVerdict(file.size, phone);
    if (verdict.kind === "refuse") {
      setError(verdict.message);
      return;
    }
    setTriageFile(file);
    if (inputRef.current) inputRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  }

  async function viewFile(file: PlanFile) {
    setBusyId(file.id);
    setError(null);
    const { data, error: signErr } = await supabase.storage
      .from("plans")
      .createSignedUrl(file.storage_path, 60);
    setBusyId(null);
    if (signErr || !data?.signedUrl) {
      setError("Could not open that file. Try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteFile(file: PlanFile) {
    setBusyId(file.id);
    setError(null);
    await supabase.storage.from("plans").remove([file.storage_path]);
    const { error: dbErr } = await supabase
      .from("plan_files")
      .delete()
      .eq("id", file.id);
    setBusyId(null);
    if (dbErr) {
      setError("Could not delete that file. Try again.");
      return;
    }
    router.refresh();
  }

  // While triaging, the triage screen takes over the section.
  if (triageFile) {
    return (
      <PlanTriage
        projectId={projectId}
        file={triageFile}
        onDone={() => setTriageFile(null)}
        onCancel={() => setTriageFile(null)}
      />
    );
  }

  return (
    <section className="rounded-xl panel p-5">
      {/*
        Collapsible, so Plans is the same size as Scope, Pricing, Estimate and
        Proposal instead of towering over them. It opens by itself when there
        is nothing uploaded yet — on a new project the upload target IS the
        next thing to do — and stays shut once there are files, which is the
        state a project spends nearly all its life in.
      */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <Caret open={open} size={20} />
        <h2 className="font-heading text-lg text-foreground">Plans</h2>
        <span className="ml-auto text-xs text-muted">
          {files.length === 0
            ? "none yet"
            : `${files.length} ${files.length === 1 ? "file" : "files"}`}
        </span>
      </button>

      {open ? (
      <div className="mt-4 flex flex-col gap-4">

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files);
        }}
        className={`flex min-h-11 cursor-pointer flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-lg border border-dashed px-3 py-2 text-center transition-colors ${
          dragOver ? "border-brand bg-brand/10" : "border-border hover:border-brand/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          // PDF plan sets, and photos of sheets — the phone offers its library
          // and camera for image/*; HEIC is what an iPhone shoots.
          accept="application/pdf,.pdf,image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />
        <span className="text-sm text-foreground">
          {preparing ?? "＋ Upload plan PDFs, or photos of sheets"}
        </span>
        <span className="text-xs text-muted">
          one PDF, several at once, or your photo library — they become one set · you&apos;ll pick which sheets to keep next
        </span>
      </label>
      {/*
        A whole folder of one-sheet PDFs in one go. Folder picking is a
        desktop thing (a phone's Files app multi-selects instead), and the
        attribute has no React typing, hence the spread.
      */}
      <label className="-mt-2 hidden cursor-pointer self-center text-xs text-muted hover:text-brand-soft md:inline">
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(e) => pick(e.target.files)}
        />
        …or choose a whole folder of sheets
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-soft"
        >
          {error}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 basis-48 flex-col">
                <span className="truncate text-sm text-foreground" title={f.file_name}>
                  {f.file_name}
                </span>
                <span className="text-xs text-muted">
                  {formatSize(f.size_bytes)} ·{" "}
                  {new Date(f.created_at).toLocaleDateString()}
                </span>
              </div>
              {/* Wraps under the name on a phone instead of clipping */}
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/projects/${projectId}/plans/${f.id}`}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-strong"
                >
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => viewFile(f)}
                  disabled={busyId === f.id}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-50"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => deleteFile(f)}
                  disabled={busyId === f.id}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
      ) : null}
    </section>
  );
}

