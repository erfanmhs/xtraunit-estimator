"use client";

/**
 * One-time "prepare plans" step (browser-side, free):
 *  1. Extract each sheet's text from the PDFs and cache it, so scope generation
 *     can send cheap text instead of the heavy PDFs.
 *  2. For scanned / image-only sheets (no text layer), render the page to a
 *     downscaled JPEG and assemble a small "vision PDF" of just those pages —
 *     the original plan set is usually far too big for the AI to read, but this
 *     compact version isn't. Its path is saved on the plan file; generation
 *     sends it to the AI instead of the giant original.
 *
 * Runs automatically when a plan still has un-ingested sheets, or has scanned
 * sheets but no vision PDF yet. Keyed off ingest_method so it doesn't re-run.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@/lib/supabase/client";
import { getPdfjs } from "@/lib/pdfClient";
import { classifyDiscipline } from "@/lib/scope/discipline";

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
  name: string | null;
  label: string | null;
  discipline: string | null;
};

// Render scanned pages at this long-edge (px) and JPEG quality. A balance
// between legibility for the AI and staying well under the PDF size limit.
const VISION_LONG_EDGE = 2000;
const VISION_JPEG_Q = 0.6;

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

  // A plan needs prep if it has an un-ingested sheet, or scanned sheets but no
  // vision PDF built yet.
  const plansToIngest = plans.filter((p) => {
    const ps = sheets.filter((s) => s.plan_file_id === p.id);
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
        const imagePages: number[] = [];
        for (const s of planSheets) {
          const page = await pdf.getPage(s.page_number);
          const content = await page.getTextContent();
          const text = content.items
            .map((it) => ("str" in it ? it.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          const method = text.length >= 25 ? "text" : "image";
          if (method === "image") imagePages.push(s.page_number);
          await supabase
            .from("sheets")
            .update({
              extracted_text: text,
              ingest_method: method,
              ingested_at: new Date().toISOString(),
            })
            .eq("id", s.id);
          // Tag the sheet's discipline for scope routing (best-effort: this is a
          // newer column, migration 0026, so ignore an error if it's absent).
          // Don't overwrite a discipline that's already set (a user correction).
          if (!s.discipline) {
            await supabase
              .from("sheets")
              .update({ discipline: classifyDiscipline(s.name, s.label) })
              .eq("id", s.id);
          }
        }

        // Build a compact, downscaled PDF of just the scanned pages for the AI.
        if (imagePages.length) {
          const out = await PDFDocument.create();
          let done = 0;
          for (const pn of imagePages.sort((a, b) => a - b)) {
            done++;
            setMsg(
              `Rendering scanned sheets of ${plan.file_name} (${done}/${imagePages.length})…`,
            );
            const page = await pdf.getPage(pn);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(
              3,
              VISION_LONG_EDGE / Math.max(base.width, base.height),
            );
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.fillStyle = "#ffffff"; // scanned pages may be transparent
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            const jpg = dataUrlToBytes(
              canvas.toDataURL("image/jpeg", VISION_JPEG_Q),
            );
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
          if (!up.error) {
            await supabase
              .from("plan_files")
              .update({ vision_pdf_path: visionPath })
              .eq("id", plan.id);
          }
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
        PDFs, and renders any scanned sheets so the AI can see them.)
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
