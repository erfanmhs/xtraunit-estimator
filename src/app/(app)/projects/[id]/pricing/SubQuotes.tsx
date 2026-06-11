"use client";

/**
 * Sub quotes — trade-partner lump sums.
 * Upload the quote (PDF or photo) → AI reads it (sub, trade, divisions, date,
 * total, inclusions/exclusions) → review → Apply spreads the total across the
 * covered lines (subcontractor bucket, 'proposed' until confirmed). Manual
 * entry works without a document. Removing a quote un-prices the lines it
 * still covers (confirmed lines are never touched).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  readQuoteDoc,
  applySubQuote,
  removeSubQuote,
} from "./actions";
import type { QuoteExtraction } from "@/lib/scope/subquote";
import { evalFormula } from "@/lib/formula";

export type SubQuote = {
  id: string;
  sub_name: string;
  trade: string | null;
  division_codes: string[] | null;
  quote_date: string | null;
  total: number;
  file_name: string | null;
  notes: string | null;
  covered_count: number;
};

const DIVISIONS = [
  ["02", "Demolition"],
  ["03", "Concrete"],
  ["04", "Masonry"],
  ["05", "Metals"],
  ["06", "Wood & Plastics"],
  ["07", "Thermal & Moisture"],
  ["08", "Openings"],
  ["09", "Finishes"],
  ["10", "Specialties"],
  ["21", "Fire Suppression"],
  ["22", "Plumbing"],
  ["23", "HVAC"],
  ["26", "Electrical"],
  ["31", "Earthwork"],
  ["32", "Exterior Impr."],
] as const;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export default function SubQuotes({
  projectId,
  userId,
  quotes,
}: {
  projectId: string;
  userId: string;
  quotes: SubQuote[];
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // status message
  const [error, setError] = useState<string | null>(null);

  // Form fields (filled by AI or by hand)
  const [subName, setSubName] = useState("");
  const [trade, setTrade] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [total, setTotal] = useState("");
  const [divisions, setDivisions] = useState<string[]>([]);
  const [extraction, setExtraction] = useState<QuoteExtraction | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function resetForm() {
    setSubName("");
    setTrade("");
    setQuoteDate("");
    setTotal("");
    setDivisions([]);
    setExtraction(null);
    setFilePath(null);
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFilePicked(file: File) {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("Use a PDF or a photo (JPG/PNG/WebP) of the quote.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Keep quote files under 20 MB.");
      return;
    }
    try {
      setBusy("Uploading the quote…");
      const path = `${userId}/${projectId}/quotes/${Date.now()}-${file.name.replace(/[^\w.\- ]+/g, "")}`;
      const { error: upErr } = await supabase.storage
        .from("plans")
        .upload(path, file, { contentType: file.type });
      if (upErr) throw new Error("Upload failed — try again.");
      setFilePath(path);
      setFileName(file.name);

      setBusy("AI is reading the quote…");
      const res = await readQuoteDoc(path, file.type, file.name);
      if (!res.ok || !res.extraction) throw new Error(res.error ?? "Read failed.");
      const x = res.extraction;
      setExtraction(x);
      setSubName(x.sub_name);
      setTrade(x.trade);
      setQuoteDate(x.quote_date ?? "");
      setTotal(x.total ? String(x.total) : "");
      setDivisions(x.division_codes.filter((c) => DIVISIONS.some(([d]) => d === c)));
      setBusy(null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  async function onApply() {
    const totalVal = evalFormula(total);
    setError(null);
    if (!subName.trim()) return setError("Who is the quote from?");
    if (totalVal == null || totalVal <= 0)
      return setError("Enter the quote total.");
    if (!divisions.length)
      return setError("Pick the division(s) this quote covers.");
    setBusy("Applying the quote to the covered lines…");
    const res = await applySubQuote(projectId, {
      sub_name: subName,
      trade: trade.trim() || null,
      division_codes: divisions,
      quote_date: quoteDate.trim() || null,
      total: totalVal,
      notes: null,
      file_path: filePath,
      file_name: fileName,
      extracted: extraction,
    });
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Could not apply the quote.");
    resetForm();
    setOpen(false);
    router.refresh();
  }

  async function onRemove(id: string) {
    setError(null);
    setBusy("Removing the quote…");
    const res = await removeSubQuote(id);
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Could not remove the quote.");
    router.refresh();
  }

  return (
    <section className="glass mt-6 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
            Sub quotes
          </h2>
          <p className="text-xs text-muted">
            A trade partner&apos;s lump sum, spread over the lines it covers.
            Upload the quote and the AI reads it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setError(null);
          }}
          className="glass-brand shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground hover:bg-brand/30"
        >
          {open ? "Close" : "+ Add sub quote"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="mt-3 animate-pulse rounded-lg border border-border px-3 py-2 text-sm text-muted">
          {busy}
        </p>
      ) : null}

      {/* Existing quotes */}
      {quotes.length > 0 ? (
        <div className="mt-3 divide-y divide-white/5">
          {quotes.map((q) => (
            <div key={q.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">
                  {q.sub_name}
                  {q.trade ? <span className="text-muted"> · {q.trade}</span> : null}
                </p>
                <p className="text-[11px] text-muted">
                  {(q.division_codes ?? []).map((d) => `Div ${d}`).join(", ")}
                  {q.quote_date ? ` · ${q.quote_date}` : ""} · covers{" "}
                  {q.covered_count} lines
                  {q.file_name ? ` · ${q.file_name}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-medium text-foreground">
                {usd.format(q.total)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(q.id)}
                title="Remove quote and un-price the lines it covers (confirmed lines stay)"
                className="shrink-0 text-[11px] text-muted transition-colors hover:text-brand-soft"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Add form */}
      {open ? (
        <div className="mt-3 rounded-lg border border-white/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFilePicked(f);
              }}
              className="text-xs text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-foreground"
            />
            <span className="text-[11px] text-muted/70">
              PDF or photo — AI fills the fields below. Or type them yourself.
            </span>
          </div>

          {extraction ? (
            <div className="mt-2 rounded-md border border-border bg-black/20 px-3 py-2 text-xs text-muted">
              <p className="text-foreground">{extraction.summary}</p>
              {extraction.exclusions.length ? (
                <p className="mt-1">
                  <span className="text-amber-300">Excludes:</span>{" "}
                  {extraction.exclusions.join("; ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              placeholder="Sub name (ABC Plumbing)"
              className="w-48 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
            />
            <input
              type="text"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder="Trade"
              className="w-32 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
            />
            <input
              type="text"
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              placeholder="Quote date"
              className="w-28 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
            />
            <input
              type="text"
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="Total $"
              className="w-32 rounded-md border border-border bg-black/20 px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-brand"
            />
          </div>

          <div className="mt-2">
            <p className="mb-1 text-[11px] uppercase tracking-wider text-muted">
              Covers divisions
            </p>
            <div className="flex flex-wrap gap-1">
              {DIVISIONS.map(([code, label]) => {
                const active = divisions.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setDivisions((d) =>
                        active ? d.filter((x) => x !== code) : [...d, code],
                      )
                    }
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      active
                        ? "border-brand bg-brand/20 text-foreground"
                        : "border-border text-muted hover:border-brand"
                    }`}
                  >
                    {code} {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!!busy}
              className="glass-brand rounded-lg px-4 py-1.5 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
            >
              Apply quote to covered lines
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
