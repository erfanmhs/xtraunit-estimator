"use client";

/**
 * $/SF benchmarks editor (lives under Cost Database). Your typical SELL price
 * per square foot by project type — the AI's whole-job reality anchor.
 */
import { useState, useTransition } from "react";
import {
  saveBenchmarks,
  type Benchmark,
  type ObservedBenchmark,
} from "./actions";
import { evalFormula } from "@/lib/formula";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function BenchmarksEditor({
  initial,
  observed = [],
}: {
  initial: Benchmark[];
  observed?: ObservedBenchmark[];
}) {
  const [rows, setRows] = useState<{ label: string; low: string; high: string }[]>(
    () =>
      initial.map((b) => ({
        label: b.label,
        low: b.sell_low == null ? "" : String(b.sell_low),
        high: b.sell_high == null ? "" : String(b.sell_high),
      })),
  );
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (i: number, f: "label" | "low" | "high", v: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [f]: v } : x)));

  function onSave() {
    setState("idle");
    setError(null);
    const clean: Benchmark[] = rows
      .map((b) => ({
        label: b.label.trim(),
        sell_low: evalFormula(b.low),
        sell_high: evalFormula(b.high),
      }))
      .filter((b) => b.label && (b.sell_low != null || b.sell_high != null));
    start(async () => {
      const res = await saveBenchmarks(clean);
      if (res.ok) setState("saved");
      else {
        setState("error");
        setError(res.error ?? "Could not save.");
      }
    });
  }

  return (
    <>
      {observed.length ? (
        <section className="glass mb-4 rounded-xl p-5">
          <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
            Your observed direct cost — from confirmed jobs
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Computed live from your confirmed lines ÷ building size. This is{" "}
            <span className="text-foreground">direct cost</span> (before markups),
            so it should land below your sell $/SF band — a quick reality check on
            whether your benchmarks are still right.
          </p>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">
              <span className="flex-1">Project type</span>
              <span className="w-44 text-right">Direct $/SF (range)</span>
              <span className="w-24 text-right">Median</span>
              <span className="w-16 text-right">Jobs</span>
            </div>
            {observed.map((o) => (
              <div
                key={o.label}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <span className="flex-1 truncate">{o.label}</span>
                <span className="w-44 text-right text-muted">
                  {usd.format(o.low)}–{usd.format(o.high)}/SF
                </span>
                <span className="w-24 text-right">{usd.format(o.median)}</span>
                <span className="w-16 text-right text-muted">{o.n}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="glass rounded-xl p-5">
      <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
        Price-per-SF benchmarks
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        Your typical SELL price per square foot, by project type. The AI uses
        these as a reality check so its pricing lands near what XtraUnit actually
        sells. Enter the all-in $/SF range you bid each type at.
      </p>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">
          <span className="flex-1">Project type</span>
          <span className="w-24 text-right">$/SF low</span>
          <span className="w-24 text-right">$/SF high</span>
          <span className="w-6" />
        </div>
        {rows.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={b.label}
              onChange={(e) => set(i, "label", e.target.value)}
              placeholder="e.g. ADU"
              className="flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
            />
            <input
              type="text"
              inputMode="decimal"
              value={b.low}
              onChange={(e) => set(i, "low", e.target.value)}
              placeholder="250"
              className="w-24 rounded-md border border-border bg-black/20 px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-brand"
            />
            <input
              type="text"
              inputMode="decimal"
              value={b.high}
              onChange={(e) => set(i, "high", e.target.value)}
              placeholder="300"
              className="w-24 rounded-md border border-border bg-black/20 px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              title="Remove"
              className="w-6 text-center text-muted transition-colors hover:text-brand-soft"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setRows((r) => [...r, { label: "", low: "", high: "" }])
          }
          className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-foreground"
        >
          + Add type
        </button>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {state === "saved" ? (
          <span className="text-sm text-green-300">Saved ✓</span>
        ) : null}
        {state === "error" && error ? (
          <span className="text-sm text-brand-soft">{error}</span>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="glass-brand rounded-lg px-5 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save benchmarks"}
        </button>
      </div>
      </section>
    </>
  );
}
