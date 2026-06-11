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
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function pick(fileList: FileList | null) {
    setError(null);
    const file = fileList?.[0];
    if (!file) return;
    if (file.type && file.type !== "application/pdf") {
      setError("Only PDF plan sets are supported.");
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
    <section className="flex flex-col gap-4 rounded-xl glass p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg text-foreground">Plans</h2>
        <span className="text-xs text-muted">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>

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
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
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
        <span className="text-sm text-foreground">
          Click to upload or drag a plan PDF here
        </span>
        <span className="text-xs text-muted">
          You&apos;ll pick which sheets to keep next
        </span>
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
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground" title={f.file_name}>
                  {f.file_name}
                </span>
                <span className="text-xs text-muted">
                  {formatSize(f.size_bytes)} ·{" "}
                  {new Date(f.created_at).toLocaleDateString()}
                </span>
              </div>
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
    </section>
  );
}
