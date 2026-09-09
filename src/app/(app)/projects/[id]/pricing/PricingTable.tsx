"use client";

/**
 * The pricing canvas.
 *  - Five cost buckets per line (labor/material/sub/equipment/other) at $/unit
 *    or lump $, OR one final Total — whichever the user prefers per line.
 *  - Every cell takes Excel-style formulas: 2.5*1.1, (100+50)/2, etc.
 *  - Descriptions are click-to-edit right here (no trip back to Scope); lines
 *    can be added or excluded here too. Edits mark the line user-owned so a
 *    scope regenerate never overwrites them.
 *  - Divisions are collapsible; a collapsed division keeps its title + total.
 *  - Status per line: unpriced → "needs confirm" (amber) → confirmed (green).
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  updateLinePrice,
  confirmLinePrice,
  confirmManyPrices,
  clearLinePrice,
  clearAllPrices,
  type PricePatch,
} from "./actions";
import { updateLineItem, setLineStatus, addLineItem, deleteLineItem } from "../scope/actions";
import { evalFormula } from "@/lib/formula";
import SwipeRow from "@/components/SwipeRow";

export type PricedLine = {
  id: string;
  division_code: string | null;
  division_name: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  status: string | null;
  price_mode: string | null; // 'unit' | 'lump' | 'total'
  cost_labor: number | null;
  cost_material: number | null;
  cost_sub: number | null;
  cost_equipment: number | null;
  cost_other: number | null;
  cost_total: number | null;
  price_source: string | null;
  price_note: string | null;
  price_confidence: string | null;
  price_status: string | null;
};

const BUCKETS = [
  ["cost_labor", "Labor"],
  ["cost_material", "Material"],
  ["cost_sub", "Sub"],
  ["cost_equipment", "Equip"],
  ["cost_other", "Other"],
] as const;

const SOURCES = [
  ["manual", "My number"],
  ["sub_quote", "Sub quote"],
  ["history", "My history"],
  ["market", "Market est."],
] as const;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function bucketSum(li: PricedLine): number {
  return (
    (li.cost_labor ?? 0) +
    (li.cost_material ?? 0) +
    (li.cost_sub ?? 0) +
    (li.cost_equipment ?? 0) +
    (li.cost_other ?? 0)
  );
}

export function lineTotal(li: PricedLine): number {
  const mode = li.price_mode ?? "unit";
  if (mode === "total") return li.cost_total ?? 0;
  const sum = bucketSum(li);
  if (mode === "lump") return sum;
  return (li.quantity ?? 0) * sum;
}

function hasPrice(li: PricedLine): boolean {
  return li.price_status === "proposed" || li.price_status === "confirmed";
}

// One-line row layout at xl+: description | 5 buckets | total | source | amount | actions.
// Below xl the same cells wrap onto a second line (see Row), so a line item is
// two lines on a laptop/tablet and one on a wide screen — never three.
const GRID =
  "xl:grid xl:grid-cols-[minmax(0,1fr)_repeat(5,3.75rem)_4.5rem_5.5rem_5.5rem_6rem] xl:items-center xl:gap-x-1.5";

const CELL =
  "rounded-md border border-border bg-input px-1.5 py-1 text-right text-xs text-foreground outline-none focus:border-brand";

export default function PricingTable({
  projectId,
  initialItems,
}: {
  projectId: string;
  initialItems: PricedLine[];
}) {
  const [items, setItems] = useState<PricedLine[]>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingDiv, setAddingDiv] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setItems(initialItems), [initialItems]);

  function run(
    optimistic: () => void,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    const snapshot = items;
    setError(null);
    optimistic();
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setItems(snapshot);
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  function patchLocal(id: string, patch: Partial<PricedLine>) {
    setItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, ...patch } : li)),
    );
  }

  function onSavePrice(id: string, patch: PricePatch) {
    run(
      () => patchLocal(id, { ...patch, price_status: "proposed" }),
      () => updateLinePrice(id, patch),
    );
  }

  function onConfirm(id: string) {
    run(
      () => patchLocal(id, { price_status: "confirmed" }),
      () => confirmLinePrice(id),
    );
  }

  function onClearAll() {
    if (
      !window.confirm(
        "Clear every price on this project? The lines stay — only the prices reset. Confirmed prices already saved to your Cost Database are kept there.",
      )
    )
      return;
    run(
      () =>
        setItems((prev) =>
          prev.map((li) => ({
            ...li,
            price_mode: "unit",
            cost_labor: null,
            cost_material: null,
            cost_sub: null,
            cost_equipment: null,
            cost_other: null,
            cost_total: null,
            price_source: null,
            price_note: null,
            price_confidence: null,
            price_status: "unpriced",
          })),
        ),
      () => clearAllPrices(projectId),
    );
  }

  function onConfirmMany(ids: string[]) {
    if (!ids.length) return;
    run(
      () =>
        setItems((prev) =>
          prev.map((li) =>
            ids.includes(li.id) && li.price_status === "proposed"
              ? { ...li, price_status: "confirmed" }
              : li,
          ),
        ),
      () => confirmManyPrices(ids),
    );
  }

  function onClear(id: string) {
    run(
      () =>
        patchLocal(id, {
          price_mode: "unit",
          cost_labor: null,
          cost_material: null,
          cost_sub: null,
          cost_equipment: null,
          cost_other: null,
          cost_total: null,
          price_source: null,
          price_note: null,
          price_confidence: null,
          price_status: "unpriced",
        }),
      () => clearLinePrice(id),
    );
  }

  function onEditDesc(id: string, description: string) {
    run(
      () => patchLocal(id, { description }),
      () => updateLineItem(id, { description }),
    );
  }

  function onExclude(id: string) {
    run(
      () => setItems((prev) => prev.filter((li) => li.id !== id)),
      () => setLineStatus(id, "excluded"),
    );
  }

  // Remove the line for good (Exclude keeps it, struck through, on Scope).
  function onDelete(id: string) {
    run(
      () => setItems((prev) => prev.filter((li) => li.id !== id)),
      () => deleteLineItem(id),
    );
  }

  function onAdd(
    div: { code: string | null; name: string | null },
    fields: { description: string; quantity: number | null; unit: string | null },
  ) {
    setAddingDiv(null);
    setError(null);
    startTransition(async () => {
      const res = await addLineItem(projectId, {
        division_code: div.code,
        division_name: div.name,
        ...fields,
      });
      if (!res.ok || !res.id) {
        setError(res.error ?? "Could not add the line.");
        return;
      }
      setItems((prev) => [
        ...prev,
        {
          id: res.id!,
          division_code: div.code,
          division_name: div.name,
          description: fields.description,
          quantity: fields.quantity,
          unit: fields.unit,
          status: "confirmed",
          price_mode: "unit",
          cost_labor: null,
          cost_material: null,
          cost_sub: null,
          cost_equipment: null,
          cost_other: null,
          cost_total: null,
          price_source: null,
          price_note: null,
          price_confidence: null,
          price_status: "unpriced",
        },
      ]);
    });
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const groups = useMemo(() => {
    const gs: {
      key: string;
      code: string | null;
      name: string | null;
      rows: PricedLine[];
    }[] = [];
    for (const li of items) {
      const key = `${li.division_code ?? "—"} · ${li.division_name ?? "Other"}`;
      let g = gs.find((x) => x.key === key);
      if (!g) {
        g = { key, code: li.division_code, name: li.division_name, rows: [] };
        gs.push(g);
      }
      g.rows.push(li);
    }
    return gs;
  }, [items]);

  const confirmedTotal = items
    .filter((li) => li.price_status === "confirmed")
    .reduce((a, li) => a + lineTotal(li), 0);
  const projectedTotal = items
    .filter(hasPrice)
    .reduce((a, li) => a + lineTotal(li), 0);
  const unpricedCount = items.filter((li) => !hasPrice(li)).length;
  const needsConfirm = items.filter(
    (li) => li.price_status === "proposed",
  ).length;

  return (
    <div className="mt-6">
      {/* Totals bar: the two numbers, the status counts, the bulk actions.
          Wraps in that order at narrow widths; nothing is crammed in a corner. */}
      <div className="glass sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-4 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Confirmed
          </p>
          <p className="font-heading text-lg leading-tight text-green-300">
            {usd.format(confirmedTotal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Projected
          </p>
          <p className="font-heading text-lg leading-tight text-foreground">
            {usd.format(projectedTotal)}
          </p>
        </div>
        <div className="text-xs text-muted">
          {needsConfirm > 0 ? (
            <p className="text-amber-300">{needsConfirm} need confirm</p>
          ) : null}
          {unpricedCount > 0 ? <p>{unpricedCount} unpriced</p> : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {items.some(hasPrice) ? (
            <button
              type="button"
              onClick={onClearAll}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-brand hover:text-brand-soft"
            >
              Clear all
            </button>
          ) : null}
          {needsConfirm > 0 ? (
            <button
              type="button"
              onClick={() =>
                onConfirmMany(
                  items
                    .filter((li) => li.price_status === "proposed")
                    .map((li) => li.id),
                )
              }
              className="glass-brand rounded-lg px-3 py-1.5 text-sm font-medium text-foreground hover:bg-brand/30"
            >
              Confirm all ({needsConfirm})
            </button>
          ) : null}
        </div>
      </div>
      <p className="mb-4 text-[11px] text-muted/70">
        Prices are per unit when a line has a quantity, lump sums otherwise.
        Every cell takes a formula (2.5*1.1, (100+50)/2). Markups come later.
      </p>

      {error ? (
        <p className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}

      <div className="space-y-6">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          const divTotal = g.rows
            .filter(hasPrice)
            .reduce((a, li) => a + lineTotal(li), 0);
          return (
            <section key={g.key} className="glass rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={() => toggleCollapse(g.key)}
                  className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-left"
                  aria-expanded={!isCollapsed}
                >
                  <span className="text-xs text-muted">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <h2 className="truncate font-heading text-sm uppercase tracking-wider text-brand-soft">
                    {g.key}
                  </h2>
                  <span className="shrink-0 text-[11px] text-muted">
                    {g.rows.length} lines
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-foreground">
                    {usd.format(divTotal)}
                  </span>
                  {!isCollapsed &&
                  g.rows.some((li) => li.price_status === "proposed") ? (
                    <button
                      type="button"
                      onClick={() =>
                        onConfirmMany(
                          g.rows
                            .filter((li) => li.price_status === "proposed")
                            .map((li) => li.id),
                        )
                      }
                      className="rounded-md border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-300 transition-colors hover:bg-green-500/20"
                    >
                      Confirm section (
                      {g.rows.filter((li) => li.price_status === "proposed").length}
                      )
                    </button>
                  ) : null}
                  {!isCollapsed ? (
                    <button
                      type="button"
                      onClick={() =>
                        setAddingDiv(addingDiv === g.key ? null : g.key)
                      }
                      className="rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-foreground"
                    >
                      + Add line
                    </button>
                  ) : null}
                </div>
              </div>

              {!isCollapsed ? (
                <div className="mt-2 divide-y divide-border">
                  {/* Column headers — only when rows are one line (xl+) */}
                  <div className={`${GRID} hidden pb-1 text-[10px] uppercase tracking-wider text-muted xl:grid`}>
                    <span>Line</span>
                    {BUCKETS.map(([k, label]) => (
                      <span key={k} className="text-right">
                        {label}
                      </span>
                    ))}
                    <span className="text-right text-brand-soft">Total</span>
                    <span>Source</span>
                    <span className="text-right">Amount</span>
                    <span />
                  </div>
                  {g.rows.map((li) => (
                    <Row
                      key={li.id}
                      item={li}
                      onSave={(patch) => onSavePrice(li.id, patch)}
                      onConfirm={() => onConfirm(li.id)}
                      onClear={() => onClear(li.id)}
                      onEditDesc={(d) => onEditDesc(li.id, d)}
                      onExclude={() => onExclude(li.id)}
                      onDelete={() => onDelete(li.id)}
                    />
                  ))}
                  {addingDiv === g.key ? (
                    <AddRow
                      onCancel={() => setAddingDiv(null)}
                      onAdd={(f) => onAdd({ code: g.code, name: g.name }, f)}
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  item: li,
  onSave,
  onConfirm,
  onClear,
  onEditDesc,
  onExclude,
  onDelete,
}: {
  item: PricedLine;
  onSave: (patch: PricePatch) => void;
  onConfirm: () => void;
  onClear: () => void;
  onEditDesc: (description: string) => void;
  onExclude: () => void;
  onDelete: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => fromItem(li));
  const [total, setTotal] = useState(li.cost_total ? String(li.cost_total) : "");
  const [source, setSource] = useState(li.price_source ?? "manual");
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(li.description);

  // Mode is internal now (no selector): buckets are $/unit when the line has a
  // quantity; lump-sum lines (e.g. sub quotes) keep their stored mode.
  const mode =
    (li.price_mode ?? "unit") === "total" ? "unit" : (li.price_mode ?? "unit");

  useEffect(() => {
    setVals(fromItem(li));
    setTotal(li.cost_total ? String(li.cost_total) : "");
    setSource(li.price_source ?? "manual");
    setDesc(li.description);
  }, [li]);

  function fromItem(x: PricedLine): Record<string, string> {
    // 0 shows as an empty cell — zeros are clutter, not information.
    const o: Record<string, string> = {};
    for (const [k] of BUCKETS) o[k] = x[k] ? String(x[k]) : "";
    return o;
  }

  const totalVal = evalFormula(total);
  const usingTotal = totalVal != null;

  function buildPatch(): PricePatch {
    return {
      price_mode: usingTotal ? "total" : mode,
      cost_labor: evalFormula(vals.cost_labor),
      cost_material: evalFormula(vals.cost_material),
      cost_sub: evalFormula(vals.cost_sub),
      cost_equipment: evalFormula(vals.cost_equipment),
      cost_other: evalFormula(vals.cost_other),
      cost_total: totalVal,
      price_source: source,
    };
  }

  function anyValue(p: PricePatch): boolean {
    return (
      p.cost_total != null ||
      [p.cost_labor, p.cost_material, p.cost_sub, p.cost_equipment, p.cost_other].some(
        (v) => v != null,
      )
    );
  }

  function saveIfChanged() {
    const p = buildPatch();
    const changed =
      (li.price_mode ?? "unit") !== p.price_mode ||
      (li.price_source ?? "manual") !== p.price_source ||
      (li.cost_total ?? null) !== (p.cost_total ?? null) ||
      BUCKETS.some(([k]) => (li[k] ?? null) !== (p[k as keyof PricePatch] ?? null));
    if (changed && anyValue(p)) onSave(p);
  }

  function saveDesc() {
    setEditingDesc(false);
    const d = desc.trim();
    if (d && d !== li.description) onEditDesc(d);
    else setDesc(li.description);
  }

  const confirmed = li.price_status === "confirmed";
  const proposed = li.price_status === "proposed";
  const isUnit = mode !== "lump";
  const previewSum = BUCKETS.reduce(
    (a, [k]) => a + (evalFormula(vals[k]) ?? 0),
    0,
  );
  const previewTotal = usingTotal
    ? totalVal
    : isUnit
      ? (li.quantity ?? 0) * previewSum
      : previewSum;
  const showAmount = usingTotal || previewSum > 0;
  const qtyText =
    li.quantity != null ? `${li.quantity} ${li.unit ?? ""}`.trim() : "no qty";
  // The AI's reasoning is worth a glance while a price still needs review;
  // once confirmed it's noise, so it folds into the amount's tooltip.
  const note = [li.price_note, li.price_confidence ? `${li.price_confidence} confidence` : null]
    .filter(Boolean)
    .join(" · ");
  const statusText = proposed ? "needs confirm" : confirmed ? "confirmed" : "unpriced";

  // Touch: swipe left for Exclude / Delete; hold for every action. The
  // visible buttons stay for everyone.
  const swipe = [
    { label: "Exclude", onClick: onExclude },
    { label: "Delete", onClick: onDelete, tone: "danger" as const },
  ];
  const sheet = [
    ...(proposed ? [{ label: "Confirm price", onClick: onConfirm, tone: "primary" as const }] : []),
    ...(proposed || confirmed ? [{ label: "Clear price", onClick: onClear }] : []),
    ...swipe,
  ];

  return (
    <SwipeRow actions={swipe} sheetActions={sheet}>
    <div className={`group py-1.5 ${GRID}`}>
      {/* Line 1 below xl: description (+ note) with the amount and actions at
          the right. At xl this wrapper dissolves (display: contents) and the
          amount/actions are ordered to the last two grid columns. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 xl:contents">
      {/* Phone: the description takes the whole first line and the amount +
          actions drop beneath it; from sm up they share the line. */}
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
        {editingDesc ? (
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveDesc();
              if (e.key === "Escape") {
                setDesc(li.description);
                setEditingDesc(false);
              }
            }}
            autoFocus
            spellCheck
            className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
          />
        ) : (
          <p
            onClick={() => setEditingDesc(true)}
            title={`${li.description}\nClick to edit`}
            className="cursor-text truncate text-sm text-foreground hover:text-brand-soft"
          >
            {confirmed ? <span className="mr-1 text-green-400">✓</span> : null}
            {li.description}
            <span className="ml-2 text-[11px] text-muted">{qtyText}</span>
          </p>
        )}
        {proposed && note ? (
          <p className="truncate text-[11px] text-muted" title={note}>
            {note}
          </p>
        ) : null}
      </div>

        {/* Amount, colored by status (the tooltip spells it out) */}
        <p
          title={`${statusText}${note ? ` · ${note}` : ""}`}
          className={`ml-auto shrink-0 text-right text-sm font-medium tabular-nums xl:order-10 ${
            proposed ? "text-amber-300" : confirmed ? "text-green-300" : "text-muted"
          }`}
        >
          {showAmount ? usd.format(previewTotal ?? 0) : "—"}
        </p>

        {/* Actions: Confirm stays visible (it's the job); Clear/Exclude on hover */}
        <div className="flex shrink-0 items-center justify-end gap-1 text-[11px] xl:order-11">
          {proposed ? (
            <button
              type="button"
              onClick={onConfirm}
              className="glass-brand rounded-md px-2 py-0.5 font-medium text-foreground hover:bg-brand/30"
            >
              Confirm
            </button>
          ) : null}
          <span className="flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 pointer-coarse:sm:opacity-100">
            {proposed || confirmed ? (
              <button
                type="button"
                onClick={onClear}
                className="rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={onExclude}
              title="Exclude from scope & pricing (restore from the Scope page)"
              className="rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              Exclude
            </button>
          </span>
        </div>
      </div>

      {/* Line 2 below xl: the price cells — a tidy 3-column grid on phones
          (Labor·Material·Sub / Equip·Other·Total, source beneath), a wrapping
          row on laptops. At xl they become grid cells of the one-line row. */}
      <div className="mt-1.5 grid grid-cols-3 items-center gap-1.5 sm:flex sm:flex-wrap xl:contents">
        {BUCKETS.map(([k, label]) => (
          <label
            key={k}
            className={`flex min-w-0 items-center gap-1 ${usingTotal ? "opacity-40" : ""}`}
          >
            <span className="shrink-0 text-[10px] text-muted xl:hidden">{label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={vals[k]}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
              onBlur={saveIfChanged}
              placeholder="0"
              aria-label={label}
              className={`min-w-0 flex-1 sm:w-14 sm:flex-none xl:w-full ${CELL}`}
            />
          </label>
        ))}

        {/* Total: shows the line's computed total (buckets × qty, or the lump
            sum) as its placeholder; typing here overrides the buckets. */}
        <label className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-[10px] font-medium text-brand-soft xl:hidden">Total</span>
          <input
            type="text"
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            onBlur={saveIfChanged}
            placeholder={previewSum > 0 ? usd.format(previewTotal ?? 0) : "—"}
            aria-label="Total"
            title={
              previewSum > 0
                ? `${usd.format(previewTotal ?? 0)} = ${isUnit ? `${li.quantity ?? 0} × ${usd.format(previewSum)}` : "sum of the buckets"} · type a number to override`
                : "One final price for this line — overrides the buckets"
            }
            className={`min-w-0 flex-1 placeholder:text-foreground/70 sm:w-[4.5rem] sm:flex-none xl:w-full ${CELL}`}
          />
        </label>

        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onBlur={saveIfChanged}
          aria-label="Price source"
          className="col-span-3 rounded-md border border-border bg-input px-1 py-1 text-[11px] text-muted outline-none focus:border-brand sm:col-span-1 xl:w-full"
        >
          {SOURCES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
    </SwipeRow>
  );
}

function AddRow({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (f: {
    description: string;
    quantity: number | null;
    unit: string | null;
  }) => void;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");

  function save() {
    if (!description.trim()) return;
    onAdd({
      description: description.trim(),
      quantity: evalFormula(quantity),
      unit: unit.trim() || null,
    });
  }

  return (
    <div className="py-3">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="New scope line…"
        autoFocus
        spellCheck
        className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          className="w-24 rounded-md border border-border bg-input px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
        />
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="unit (sf, ea, lf…)"
          className="w-40 rounded-md border border-border bg-input px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
        />
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={save}
            disabled={!description.trim()}
            className="glass-brand rounded-md px-3 py-1 font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
          >
            Add
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
