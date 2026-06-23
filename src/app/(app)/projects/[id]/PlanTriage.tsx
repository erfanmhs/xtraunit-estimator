"use client";

/**
 * Page triage. Renders thumbnails of a dropped PDF (all pages start DROPPED),
 * lets the user keep + label the sheets that matter, then builds a trimmed PDF
 * of only the kept pages, uploads ONLY that, and records each kept sheet.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@/lib/supabase/client";
import { getPdfjs } from "@/lib/pdfClient";

const LABELS = ["Architectural", "Structural", "MEP", "Schedules", "Civil", "Other"];

type Thumb = { page: number; url: string };

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
  const ranRef = useRef(false);

  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [total, setTotal] = useState(0);
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [phase, setPhase] = useState<"rendering" | "ready" | "saving">("rendering");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const pdf = await pdfjs.getDocument({
          data: await file.arrayBuffer(),
          standardFontDataUrl: "/standard_fonts/",
        }).promise;
        setTotal(pdf.numPages);

        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = 180 / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport }).promise;
          const url = canvas.toDataURL("image/jpeg", 0.7);
          setThumbs((prev) => [...prev, { page: n, url }]);
        }
        setPhase("ready");
      } catch (e) {
        setError("Couldn't read this PDF: " + (e instanceof Error ? e.message : String(e)));
        setPhase("ready");
      }
    })();
  }, [file]);

  function toggle(page: number) {
    setKept((prev) => {
      const s = new Set(prev);
      if (s.has(page)) s.delete(page);
      else s.add(page);
      return s;
    });
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

      const src = await PDFDocument.load(await file.arrayBuffer());
      const out = await PDFDocument.create();
      const keptPages = [...kept].sort((a, b) => a - b); // 1-based page numbers
      const copied = await out.copyPages(
        src,
        keptPages.map((p) => p - 1),
      );
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save();

      // pdf-lib trims pages but doesn't recompress — show the result so the
      // user sees how big the upload is (and how much dropping pages saved).
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
      const path = `${user.id}/${projectId}/${Date.now()}-${safeName}`;
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/pdf",
      });
      const { error: upErr } = await supabase.storage
        .from("plans")
        .upload(path, blob, { contentType: "application/pdf" });
      if (upErr) {
        const mb = (bytes.length / (1024 * 1024)).toFixed(1);
        // Supabase storage rejects files over the bucket/project size limit.
        if (/exceeded the maximum allowed size|payload too large|413/i.test(upErr.message)) {
          throw new Error(
            `This trimmed plan set is ${mb} MB, over your storage upload limit. In Supabase, raise the "plans" bucket file-size limit (Storage → Buckets → plans → Edit) and the project upload limit (Storage → Settings). Or keep fewer / lighter pages.`,
          );
        }
        throw upErr;
      }

      const { data: pf, error: pfErr } = await supabase
        .from("plan_files")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          file_name: file.name,
          storage_path: path,
          size_bytes: bytes.length,
          mime_type: "application/pdf",
        })
        .select("id")
        .single();
      if (pfErr) throw pfErr;

      const rows = keptPages.map((orig, idx) => ({
        project_id: projectId,
        plan_file_id: pf.id,
        owner_id: user.id,
        page_number: idx + 1,
        original_page_number: orig,
        label: labels[orig] ?? null,
      }));
      const { error: shErr } = await supabase.from("sheets").insert(rows);
      if (shErr) {
        // Roll back so we never leave a file with no sheet records.
        await supabase.from("plan_files").delete().eq("id", pf.id);
        await supabase.storage.from("plans").remove([path]);
        throw shErr;
      }

      router.refresh();
      onDone();
    } catch (e) {
      setError("Save failed: " + (e instanceof Error ? e.message : String(e)));
      setPhase("ready");
    }
  }

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
            {saving && progress
              ? progress
              : rendering
                ? `Loading thumbnails… ${thumbs.length}/${total || "?"}`
                : `${kept.size} of ${total} pages kept — ${file.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKept(new Set())}
            disabled={saving || kept.size === 0}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || rendering || kept.size === 0}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save ${kept.size} page${kept.size === 1 ? "" : "s"}`}
          </button>
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.url} alt={`Page ${t.page}`} className="w-full" />
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                  {t.page}
                </span>
                {on ? (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-xs text-white">
                    ✓
                  </span>
                ) : null}
              </button>
              {on ? (
                <select
                  value={labels[t.page] ?? ""}
                  onChange={(e) =>
                    setLabels((prev) => ({ ...prev, [t.page]: e.target.value }))
                  }
                  disabled={saving}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                >
                  <option value="">Label…</option>
                  {LABELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
