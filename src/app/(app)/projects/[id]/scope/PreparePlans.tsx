"use client";

/**
 * One-time "prepare plans" step (browser-side, free):
 *  1. Extract each sheet's text from the PDFs — LAYOUT-AWARE, so schedules and
 *     tables keep their rows/columns instead of collapsing into a flat jumble
 *     (that jumble is why the AI couldn't read pile diameters, cut/fill, etc.).
 *  2. Render an image of any sheet the AI must SEE — scanned/image-only sheets,
 *     AND sheets that carry a schedule/table — into a compact "vision PDF" the
 *     AI reads alongside the text. Tables render at higher resolution.
 *
 * Re-runs automatically when a sheet is below the current ingest version, so
 * improvements to plan-reading upgrade already-prepared projects once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@/lib/supabase/client";
import { getPdfjs } from "@/lib/pdfClient";
import { classifyDiscipline } from "@/lib/scope/discipline";
import { hasTableContent } from "@/lib/scope/tables";
import { layoutText } from "@/lib/pdf/layoutText";

type PlanFileLite = {
  id: string;
  storage_path: string;
  file_name: string;
  hasVisionPdf: boolean;
};
type SheetLite = {
  id: string;
  page_number: number;
  plan_file_id: string;
  ingestMethod: string | null;
  ingestVersion: number | null; // null = migration 0028 not run
  name: string | null;
  label: string | null;
  discipline: string | null;
};

// Bump this when the plan-reading logic improves — already-prepared projects
// below it re-read themselves once. v2 = layout-aware text + table images.
const CURRENT_INGEST_VERSION = 2;

// Scanned pages: a balance between legibility and staying under the PDF limit.
const VISION_LONG_EDGE = 2000;
const VISION_JPEG_Q = 0.6;
// Table/schedule sheets get more resolution so small cell text stays readable.
const TABLE_LONG_EDGE = 2600;
const TABLE_JPEG_Q = 0.72;
// Guard the vision PDF's size — cap how many table sheets we render as images.
const TABLE_IMAGE_CAP = 24;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function PreparePlans({
  plans,
  sheets,
}: {
  plans: PlanFileLite[];
  sheets: SheetLite[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [msg, setMsg] = useState("");
  const ran = useRef(false);

  // A plan needs (re)prep when any sheet is below the current ingest version.
  // If migration 0028 isn't run (ingestVersion is null), fall back to the
  // original trigger: an un-ingested sheet, or a scanned sheet with no vision PDF.
  const plansToIngest = plans.filter((p) => {
    const ps = sheets.filter((s) => s.plan_file_id === p.id);
    const versioned = ps.some((s) => s.ingestVersion != null);
    if (versioned)
      return ps.some((s) => (s.ingestVersion ?? 0) < CURRENT_INGEST_VERSION);
    const hasUningested = ps.some((s) => !s.ingestMethod);
    const hasImage = ps.some((s) => s.ingestMethod === "image");
    return hasUningested || (hasImage && !p.hasVisionPdf);
  });

  const ingest = useCallback(async () => {
    setStatus("working");
    const supabase = createClient();
    try {
      const pdfjs = await getPdfjs();
      let i = 0;
      for (const plan of plansToIngest) {
        i++;
        setMsg(`Reading ${plan.file_name} (${i}/${plansToIngest.length})…`);
        const { data: blob, error } = await supabase.storage
          .from("plans")
          .download(plan.storage_path);
        if (error || !blob) throw error ?? new Error("Could not open plan.");
        const pdf = await pdfjs.getDocument({
          data: await blob.arrayBuffer(),
          standardFontDataUrl: "/standard_fonts/",
        }).promise;

        const planSheets = sheets.filter((s) => s.plan_file_id === plan.id);
        // Pages the AI must SEE, with the resolution to use.
        const renderPages: { page: number; kind: "scanned" | "table" }[] = [];
        for (const s of planSheets) {
          const page = await pdf.getPage(s.page_number);
          const content = await page.getTextContent();
          // Layout-aware text (tables keep rows/columns); fall back to the flat
          // join if reconstruction yields nothing.
          let text = "";
          try {
            text = layoutText(content.items);
          } catch {
            text = "";
          }
          if (!text) {
            text = content.items
              .map((it) => ("str" in it ? (it as { str: string }).str : ""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
          }
          const method = text.length >= 25 ? "text" : "image";
          if (method === "image") renderPages.push({ page: s.page_number, kind: "scanned" });
          else if (hasTableContent(text))
            renderPages.push({ page: s.page_number, kind: "table" });

          await supabase
            .from("sheets")
            .update({
              extracted_text: text,
              ingest_method: method,
              ingested_at: new Date().toISOString(),
            })
            .eq("id", s.id);
          // Discipline (migration 0026) — best-effort, don't overwrite a user fix.
          if (!s.discipline)
            await supabase
              .from("sheets")
              .update({ discipline: classifyDiscipline(s.name, s.label) })
              .eq("id", s.id);
          // Ingest version (migration 0028) — best-effort so this run doesn't
          // repeat once the column exists.
          await supabase
            .from("sheets")
            .update({ ingest_version: CURRENT_INGEST_VERSION })
            .eq("id", s.id);
        }

        // Keep every scanned page, cap the number of table images (size guard).
        const scanned = renderPages.filter((r) => r.kind === "scanned");
        const tables = renderPages
          .filter((r) => r.kind === "table")
          .slice(0, TABLE_IMAGE_CAP);
        const toRender = [...scanned, ...tables].sort((a, b) => a.page - b.page);

        if (toRender.length) {
          const out = await PDFDocument.create();
          let done = 0;
          for (const { page: pn, kind } of toRender) {
            done++;
            setMsg(
              `Rendering sheets for the AI — ${plan.file_name} (${done}/${toRender.length})…`,
            );
            const longEdge = kind === "table" ? TABLE_LONG_EDGE : VISION_LONG_EDGE;
            const quality = kind === "table" ? TABLE_JPEG_Q : VISION_JPEG_Q;
            const page = await pdf.getPage(pn);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(4, longEdge / Math.max(base.width, base.height));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            const jpg = dataUrlToBytes(canvas.toDataURL("image/jpeg", quality));
            const img = await out.embedJpg(jpg);
            const pg = out.addPage([img.width, img.height]);
            pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          }
          const bytes = await out.save();
          const visionPath = `${plan.storage_path}.vision.pdf`;
          const up = await supabase.storage
            .from("plans")
            .upload(
              visionPath,
              new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
              { contentType: "application/pdf", upsert: true },
            );
          if (!up.error)
            await supabase
              .from("plan_files")
              .update({ vision_pdf_path: visionPath })
              .eq("id", plan.id);
        }
      }
      setStatus("idle");
      router.refresh();
    } catch (e) {
      setStatus("error");
      setMsg(e instanceof Error ? e.message : "Could not prepare plans.");
    }
  }, [plansToIngest, sheets, router]);

  // Auto-run once when something needs ingesting.
  useEffect(() => {
    if (!ran.current && plansToIngest.length && status === "idle") {
      ran.current = true;
      ingest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "working") {
    return (
      <p className="mt-3 rounded-lg glass px-4 py-2 text-sm text-muted">
        Preparing plans for the AI… {msg} (one-time; reads the text out of your
        PDFs and renders schedules/scanned sheets so the AI can see them.)
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="mt-3 flex items-center gap-3 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
        {msg}
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            ingest();
          }}
          className="rounded border border-border px-2 py-0.5 text-foreground hover:border-brand"
        >
          Retry
        </button>
      </p>
    );
  }
  return null;
}
