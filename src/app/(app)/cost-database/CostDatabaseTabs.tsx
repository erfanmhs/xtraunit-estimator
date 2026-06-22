"use client";

/**
 * Cost Database hub — all of XtraUnit's cost knowledge in one place, in tabs:
 *   • Price history — every confirmed price (observations), grows automatically
 *   • Cost items — your canonical catalog; one standard price per item
 *   • $/SF benchmarks — your sell $/SF by type + your own observed direct $/SF
 */
import { useState } from "react";
import CostDbBrowser, { type CostEntry } from "./CostDbBrowser";
import ItemsCatalog from "./ItemsCatalog";
import BenchmarksEditor from "./BenchmarksEditor";
import type {
  Benchmark,
  UnitPrice,
  CostItem,
  ObservedBenchmark,
} from "./actions";

type Tab = "history" | "items" | "benchmarks";

export default function CostDatabaseTabs({
  entries,
  projectNames,
  items,
  unitPrices,
  benchmarks,
  observed,
}: {
  entries: CostEntry[];
  projectNames: Record<string, string>;
  items: CostItem[];
  unitPrices: UnitPrice[];
  benchmarks: Benchmark[];
  observed: ObservedBenchmark[];
}) {
  const [tab, setTab] = useState<Tab>("history");
  const tabs: { id: Tab; label: string }[] = [
    { id: "history", label: `Price history (${entries.length})` },
    { id: "items", label: `Cost items (${items.length})` },
    { id: "benchmarks", label: "$/SF benchmarks" },
  ];

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-1 border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === t.id
                ? "border-brand text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {tab === "history" ? (
          <CostDbBrowser entries={entries} projectNames={projectNames} />
        ) : null}
        {tab === "items" ? (
          <div className="mt-4">
            <ItemsCatalog items={items} legacyUnitPrices={unitPrices} />
          </div>
        ) : null}
        {tab === "benchmarks" ? (
          <div className="mt-4">
            <BenchmarksEditor initial={benchmarks} observed={observed} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
