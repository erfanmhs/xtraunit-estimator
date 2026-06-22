"use client";

/**
 * The Cost Database — your growing price history, browsable.
 * Search, edit (click the description or Edit), delete. Grouped by CSI
 * division, collapsible like the other pages. These entries are what the
 * pricing matcher and the AI reuse on future jobs — clean history, better bids.
 */
import { useMemo, useState, useTransition } from "react";
import { updateCostEntry, deleteCostEntry, type CostEntryPatch } from "./actions";
import { evalFormula } from "@/lib/formula";
import { divisionLabel } from "@/lib/csi";

export type CostEntry = {
  id: string;
  created_at: string;
  project_id: string | null;
  division_code: string | null;
  section_code: string | null;
  description: string;
  unit: string | null;
  price_mode: string | null;
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
  price_source: string | null;
  price_note: string | null;
  price_confidence: string | null;
};

const BUCKETS = [
  ["cost_labor", "Labor"],
  ["cost_material", "Material"],
  ["cost_sub", "Sub"],
  ["cost_equipment", "Equip"],
  ["cost_other", "Other"],
] as const;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function valueSummary(e: CostEntry): string {
  if ((e.price_mode ?? "unit") === "total" && e.cost_total != null)
    return `Total ${usd.format(e.cost_total)}`;
  const parts = BUCKETS.filter(([k]) => e[k] != null && e[k] !== 0).map(
    ([k, label]) => `${label} ${usd.format(e[k] as number)}`,
  );
  const suffix = (e.price_mode ?? "unit") === "lump" ? " (lump)" : `/${e.unit ?? "unit"}`;
  return parts.length ? parts.join(" · ") + suffix : "—";
}

export default function CostDbBrowser({
  entries: initialEntries,
  projectNames,
}: {
  entries: CostEntry[];
  projectNames: Record<string, string>;
}) {
  const [entries, setEntries] = useState<CostEntry[]>(initialEntries);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync to fresh server data when the props change, without an effect.
  const [prevEntries, setPrevEntries] = useState(initialEntries);
  if (initialEntries !== prevEntries) {
    setPrevEntries(initialEntries);
    setEntries(initialEntries);
  }

  function run(
    optimistic: () => void,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    const snapshot = entries;
    setError(null);
    optimistic();
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setEntries(snapshot);
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  function onSave(id: string, patch: CostEntryPatch) {
    setEditingId(null);
    run(
      () =>
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        ),
      () => updateCostEntry(id, patch),
    );
  }

  function onDelete(id: string) {
    run(
      () => setEntries((prev) => prev.filter((e) => e.id !== id)),
      () => deleteCostEntry(id),
    );
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.description.toLowerCase().includes(q) ||
        (e.section_code ?? "").toLowerCase().includes(q) ||
        (e.division_code ?? "").includes(q),
    );
  }, [entries, search]);

  const groups = useMemo(() => {
    const gs: { key: string; label: string; rows: CostEntry[] }[] = [];
    const sorted = [...filtered].sort((a, b) =>
      (a.division_code ?? "99").localeCompare(b.division_code ?? "99"),
    );
    for (const e of sorted) {
      const key = `Division ${e.division_code ?? "—"}`;
      let g = gs.find((x) => x.key === key);
      if (!g) {
        g = { key, label: `Division ${divisionLabel(e.division_code)}`, rows: [] };
        gs.push(g);
      }
      g.rows.push(e);
    }
    return gs;
  }, [filtered]);

  return (
    <div className="mt-6">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your price history… (description, section, division)"
        className="w-full max-w-md rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
      />

      {error ? (
        <p className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <section key={g.key} className="glass rounded-xl p-4">
              <button
                type="button"
                onClick={() => toggleCollapse(g.key)}
                className="flex w-full items-center gap-2 text-left"
                aria-expanded={!isCollapsed}
              >
                <span className="text-xs text-muted">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
                  {g.label}
                </h2>
                <span className="text-[11px] text-muted">
                  {g.rows.length} entries
                </span>
              </button>

              {!isCollapsed ? (
                <div className="mt-2 divide-y divide-white/5">
                  {g.rows.map((e) =>
                    editingId === e.id ? (
                      <EditEntry
                        key={e.id}
                        entry={e}
                        onCancel={() => setEditingId(null)}
                        onSave={(p) => onSave(e.id, p)}
                      />
                    ) : (
                      <div key={e.id} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <p
                            onClick={() => setEditingId(e.id)}
                            title="Click to edit"
                            className="cursor-text text-sm text-foreground hover:text-brand-soft"
                          >
                            {e.description}
                          </p>
                          <span className="shrink-0 text-right text-xs text-muted">
                            {valueSummary(e)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted/80">
                          {e.section_code ? <span>{e.section_code}</span> : null}
                          <span>{fmtDate(e.created_at)}</span>
                          {e.project_id && projectNames[e.project_id] ? (
                            <span>· {projectNames[e.project_id]}</span>
                          ) : null}
                          {e.price_source ? <span>· {e.price_source}</span> : null}
                          <button
                            type="button"
                            onClick={() => onDelete(e.id)}
                            className="ml-auto text-muted transition-colors hover:text-brand-soft"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          );
        })}

        {groups.length === 0 ? (
          <div className="rounded-xl glass p-8 text-center">
            <p className="text-sm text-muted">
              {entries.length === 0
                ? "No prices in your history yet. Confirm prices on any project's Pricing page and they'll collect here automatically."
                : "Nothing matches that search."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EditEntry({
  entry: e,
  onCancel,
  onSave,
}: {
  entry: CostEntry;
  onCancel: () => void;
  onSave: (p: CostEntryPatch) => void;
}) {
  const [description, setDescription] = useState(e.description);
  const [unit, setUnit] = useState(e.unit ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => {
    // 0 shows as an empty cell — zeros are clutter, not information.
    const o: Record<string, string> = {};
    for (const [k] of BUCKETS) o[k] = e[k] ? String(e[k]) : "";
    o.cost_total = e.cost_total ? String(e.cost_total) : "";
    return o;
  });

  function save() {
    if (!description.trim()) return;
    const totalVal = evalFormula(vals.cost_total);
    onSave({
      description: description.trim(),
      unit: unit.trim() || null,
      price_mode: totalVal != null ? "total" : (e.price_mode ?? "unit"),
      cost_labor: evalFormula(vals.cost_labor),
      cost_material: evalFormula(vals.cost_material),
      cost_sub: evalFormula(vals.cost_sub),
      cost_equipment: evalFormula(vals.cost_equipment),
      cost_other: evalFormula(vals.cost_other),
      cost_total: totalVal,
    });
  }

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={description}
          onChange={(ev) => setDescription(ev.target.value)}
          autoFocus
          className="flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
        />
        <input
          type="text"
          value={unit}
          onChange={(ev) => setUnit(ev.target.value)}
          placeholder="unit"
          className="w-20 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {BUCKETS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1">
            <span className="text-[10px] text-muted">{label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={vals[k]}
              onChange={(ev) => setVals((v) => ({ ...v, [k]: ev.target.value }))}
              placeholder="0"
              className="w-[72px] rounded-md border border-border bg-black/20 px-1.5 py-1 text-right text-xs text-foreground outline-none focus:border-brand"
            />
          </label>
        ))}
        <label className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-brand-soft">Total</span>
          <input
            type="text"
            inputMode="decimal"
            value={vals.cost_total}
            onChange={(ev) =>
              setVals((v) => ({ ...v, cost_total: ev.target.value }))
            }
            placeholder="—"
            className="w-[90px] rounded-md border border-border bg-black/20 px-1.5 py-1 text-right text-xs text-foreground outline-none focus:border-brand"
          />
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={save}
            disabled={!description.trim()}
            className="glass-brand rounded-md px-3 py-1 font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
