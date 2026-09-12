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
import CameraButton from "@/components/CameraButton";
import { SHEET_MAX_EDGE, normalizePhoto, photoFileName, photoToPdf } from "@/lib/photo";

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

  const [triageFile, setTriageFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useState(files.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [preparing, setPreparing] = useState(false);

  // A photo of a sheet, taken on site, becomes a one-page PDF and goes
  // through the same triage as an uploaded set. Scale is set in the viewer
  // with Calibrate, like any scan.
  async function onSheetPhoto(raw: File) {
    setError(null);
    setPreparing(true);
    try {
      const jpeg = await normalizePhoto(raw, SHEET_MAX_EDGE, "sheet.jpg");
      const pdf = await photoToPdf(jpeg, photoFileName("sheet-photo", "pdf"));
      pickFile(pdf);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
    } finally {
      setPreparing(false);
    }
  }

  function pick(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) pickFile(file);
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
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => pick(e.target.files)}
        />
        <span className="text-sm text-foreground">＋ Upload or drop a plan PDF</span>
        <span className="text-xs text-muted">you&apos;ll pick which sheets to keep next</span>
      </label>

      {/* On site with only a phone: photograph a sheet and measure it. */}
      <div className="flex flex-wrap items-center gap-2">
        <CameraButton onPhoto={onSheetPhoto} disabled={preparing}>
          {preparing ? "Preparing…" : "Photograph a sheet"}
        </CameraButton>
        <span className="text-xs text-muted">
          One shot per sheet; it becomes a plan you can measure once you set its scale.
        </span>
      </div>

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

