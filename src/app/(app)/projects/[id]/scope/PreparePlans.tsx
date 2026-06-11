"use client";

/**
 * One-time "prepare plans" step: extracts each sheet's text from the PDFs
 * (browser-side, free) and caches it in the database, so scope generation can
 * send cheap text instead of the heavy PDFs. Runs automatically when any sheet
 * isn't ingested yet; image-only sheets (no text layer) are flagged 'image'.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { extractPdfText } from "@/lib/scope/extractText";

type PlanFileLite = { id: string; storage_path: string; file_name: string };
type SheetLite = {
  id: string;
  page_number: number;
  plan_file_id: string;
  hasText: boolean;
};

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

  const plansToIngest = plans.filter((p) =>
    sheets.some((s) => s.plan_file_id === p.id && !s.hasText),
  );

  const ingest = useCallback(async () => {
    setStatus("working");
    const supabase = createClient();
    try {
      let i = 0;
      for (const plan of plansToIngest) {
        i++;
        setMsg(`Reading ${plan.file_name} (${i}/${plansToIngest.length})…`);
        const { data: blob, error } = await supabase.storage
          .from("plans")
          .download(plan.storage_path);
        if (error || !blob) throw error ?? new Error("Could not open plan.");
        const pages = await extractPdfText(await blob.arrayBuffer());
        const planSheets = sheets.filter((s) => s.plan_file_id === plan.id);
        for (const s of planSheets) {
          const text = pages[s.page_number - 1] ?? "";
          await supabase
            .from("sheets")
            .update({
              extracted_text: text,
              ingest_method: text.length >= 25 ? "text" : "image",
              ingested_at: new Date().toISOString(),
            })
            .eq("id", s.id);
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
        PDFs so generation is fast and cheap.)
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
