"use client";

/**
 * Cost items catalog (lives under Cost Database). The distinct things XtraUnit
 * buys, each with ONE standard price = your manual override if set, otherwise a
 * value computed from your own confirmed history. This is the AI's line-item
 * reference and it stays current on its own as you confirm jobs.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setItemOverride,
  renameItem,
  deleteItem,
  rebuildCatalogFromHistory,
  type CostItem,
  type UnitPrice,
} from "./actions";
import { evalFormula } from "@/lib/formula";
import { divisionLabel } from "@/lib/csi";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export default function ItemsCatalog({
  items: initial,
  legacyUnitPrices,
}: {
  items: CostItem[];
  legacyUnitPrices: UnitPrice[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CostItem[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [building, startBuild] = useTransition();
  const [, startAction] = useTransition();

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Re-sync to fresh server data (e.g. after a rebuild → router.refresh).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setItems(initial);
  }

  function run(
    optimistic: () => void,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    const snapshot = items;
    setError(null);
    optimistic();
    startAction(async () => {
      const res = await action();
      if (!res.ok) {
        setItems(snapshot);
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  function onRebuild() {
    setError(null);
    startBuild(async () => {
      const res = await rebuildCatalogFromHistory();
      if (!res.ok) setError(res.error ?? "Could not build the catalog.");
      else router.refresh();
    });
  }

  const groups = useMemo(() => {
    const gs: { key: string; label: string; rows: CostItem[] }[] = [];
    const sorted = [...items].sort((a, b) => {
      const d = (a.division_code ?? "zz").localeCompare(b.division_code ?? "zz");
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    for (const it of sorted) {
      const key = it.division_code ? `Division ${it.division_code}` : "Uncategorized";
      let g = gs.find((x) => x.key === key);
      if (!g) {
        const label = it.division_code
          ? `Division ${divisionLabel(it.division_code)}`
          : "Uncategorized";
        g = { key, label, rows: [] };
        gs.push(g);
      }
      g.rows.push(it);
    }
    return gs;
  }, [items]);

  // Empty catalog: offer a one-click build from history + the legacy list.
  if (!items.length) {
    return (
      <section className="glass rounded-xl p-5">
        <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
          Cost items
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Your catalog is empty. Build it from your confirmed price history and
          your standard unit prices — then each item carries one standard price
          that updates itself as you bid more jobs.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-brand-soft">{error}</p>
        ) : null}
        <button
          type="button"
          onClick={onRebuild}
          disabled={building}
          className="glass-brand mt-3 rounded-lg px-5 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
        >
          {building ? "Building…" : "Build catalog"}
        </button>
        {legacyUnitPrices.length ? (
          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-wider text-muted">
              Will import these standard unit prices:
            </p>
            <div className="mt-2 space-y-1">
              {legacyUnitPrices.map((u, i) => (
                <div key={i} className="flex justify-between text-xs text-muted">
                  <span>{u.item}</span>
                  <span>
                    {u.cost != null ? usd.format(u.cost) : "—"} / {u.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="glass rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm uppercase tracking-wider text-brand-soft">
            Cost items ({items.length})
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            One standard price per item — your override if you set one, otherwise
            the median of your own confirmed prices. The AI prices from these.
          </p>
        </div>
        <button
          type="button"
          onClick={onRebuild}
          disabled={building}
          title="Re-group history and import any new standard unit prices"
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-foreground disabled:opacity-50"
        >
          {building ? "Rebuilding…" : "Rebuild from history"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-brand-soft">{error}</p> : null}

      <div className="mt-4 space-y-3">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
          <div key={g.key} className="rounded-lg border border-white/5">
            <button
              type="button"
              onClick={() => toggleCollapse(g.key)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
              aria-expanded={!isCollapsed}
            >
              <span className="text-xs text-muted">
                {isCollapsed ? "▸" : "▾"}
              </span>
              <h3 className="text-[11px] uppercase tracking-wider text-brand-soft">
                {g.label}
              </h3>
              <span className="text-[11px] text-muted">
                {g.rows.length} item{g.rows.length === 1 ? "" : "s"}
              </span>
            </button>
            {!isCollapsed ? (
            <div className="divide-y divide-white/5 px-2 pb-1">
              {g.rows.map((it) =>
                editingId === it.id ? (
                  <EditItem
                    key={it.id}
                    item={it}
                    onCancel={() => setEditingId(null)}
                    onSave={(name, unit) => {
                      setEditingId(null);
                      run(
                        () =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === it.id ? { ...x, name, unit } : x,
                            ),
                          ),
                        () => renameItem(it.id, name, unit),
                      );
                    }}
                  />
                ) : (
                  <ItemRow
                    key={it.id}
                    item={it}
                    onEditName={() => setEditingId(it.id)}
                    onOverride={(v) =>
                      run(
                        () =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === it.id ? { ...x, std_cost_override: v } : x,
                            ),
                          ),
                        () => setItemOverride(it.id, v),
                      )
                    }
                    onDelete={() =>
                      run(
                        () =>
                          setItems((prev) => prev.filter((x) => x.id !== it.id)),
                        () => deleteItem(it.id),
                      )
                    }
                  />
                ),
              )}
            </div>
            ) : null}
          </div>
          );
        })}
      </div>
    </section>
  );
}

function ItemRow({
  item: it,
  onEditName,
  onOverride,
  onDelete,
}: {
  item: CostItem;
  onEditName: () => void;
  onOverride: (v: number | null) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(
    it.std_cost_override == null ? "" : String(it.std_cost_override),
  );
  // Reflect a changed override (e.g. cleared elsewhere) without an effect.
  const [prevOverride, setPrevOverride] = useState(it.std_cost_override);
  if (it.std_cost_override !== prevOverride) {
    setPrevOverride(it.std_cost_override);
    setDraft(it.std_cost_override == null ? "" : String(it.std_cost_override));
  }

  const standard = it.std_cost_override ?? it.std_cost_computed ?? null;
  const basis =
    it.std_cost_override != null
      ? "your set price"
      : it.std_count
        ? `median of ${it.std_count} job${it.std_count === 1 ? "" : "s"}`
        : "no confirmed prices yet";

  function commit() {
    const v = evalFormula(draft);
    if ((v ?? null) !== (it.std_cost_override ?? null)) onOverride(v);
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p
          onClick={onEditName}
          title="Click to rename"
          className="cursor-text truncate text-sm text-foreground hover:text-brand-soft"
        >
          {it.name}
        </p>
        <p className="text-[11px] text-muted/80">
          {standard != null ? (
            <span className="text-muted">
              {usd.format(standard)} / {it.unit ?? "unit"} · {basis}
            </span>
          ) : (
            <span className="text-muted">No price yet — set one →</span>
          )}
          {it.std_cost_override != null && it.std_cost_computed != null
            ? ` · history says ${usd.format(it.std_cost_computed)}`
            : ""}
          {it.last_observed ? ` · last ${fmtDate(it.last_observed)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted">override</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={
            it.std_cost_computed != null ? String(it.std_cost_computed) : "$"
          }
          className="w-24 rounded-md border border-border bg-black/20 px-2 py-1 text-right text-sm text-foreground outline-none focus:border-brand"
        />
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Delete item"
        className="text-muted transition-colors hover:text-brand-soft"
      >
        ×
      </button>
    </div>
  );
}

function EditItem({
  item: it,
  onCancel,
  onSave,
}: {
  item: CostItem;
  onCancel: () => void;
  onSave: (name: string, unit: string | null) => void;
}) {
  const [name, setName] = useState(it.name);
  const [unit, setUnit] = useState(it.unit ?? "");
  return (
    <div className="flex items-center gap-2 py-2.5">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
      />
      <input
        type="text"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        placeholder="unit"
        className="w-20 rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={() => name.trim() && onSave(name.trim(), unit.trim() || null)}
        disabled={!name.trim()}
        className="glass-brand rounded-md px-3 py-1 text-xs font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
