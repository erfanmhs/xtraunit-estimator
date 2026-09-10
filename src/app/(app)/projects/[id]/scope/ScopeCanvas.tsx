"use client";

/**
 * Editable scope canvas — a two-level accordion (docs/SCOPE-WBS-DESIGN.md).
 *
 *   Trade package   what a sub bids and the client reads (Plumbing, Framing…)
 *     └ Work package  one line: a plain-language deliverable, its quantity,
 *                     its CSI code as a cost-coding attribute, and its own
 *                     includes / excludes.
 *
 * Trades start collapsed, so the user reads ~18 headings instead of scrolling
 * 160 rows, and opens only the trade they care about. Each AI-drafted line
 * can be confirmed, edited, or excluded; you can add your own lines too.
 * Anything you touch is protected from the next AI regenerate (the server
 * sets user_edited = true). Excluded lines are kept (dimmed + struck through)
 * and can be restored or permanently removed.
 *
 * Lines written before migration 0041 carry no trade of their own; they are
 * filed by CSI section on the fly (groupByTrade), so an old project reads by
 * trade too.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import SwipeRow from "@/components/SwipeRow";
import Caret from "@/components/Caret";
import { groupByTrade, tradeOf } from "@/lib/scope/trades";
import {
  updateLineItem,
  setLineStatus,
  deleteLineItem,
  addLineItem,
} from "./actions";

export type LineItem = {
  id: string;
  division_code: string | null;
  division_name: string | null;
  section_code: string | null;
  section_name: string | null;
  trade_package: string | null;
  trade_sequence: number | null;
  deliverable: string | null;
  includes: string | null;
  excludes: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  source_kind: string | null;
  confidence: string | null;
  status: string | null;
  evidence: {
    text?: string | null;
    formula?: string | null;
    assumptions?: string[] | null;
  } | null;
  sort_order: number | null;
};

/** The editable text of a line, as the edit form sees it. */
type LineFields = {
  description: string;
  deliverable: string | null;
  includes: string | null;
  excludes: string | null;
  quantity: number | null;
  unit: string | null;
};

const CONF: Record<string, string> = {
  high: "bg-green-500/15 text-green-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-brand/20 text-brand-soft",
};

function qtyToInput(q: number | null) {
  return q == null ? "" : String(q);
}
function parseQty(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function ScopeCanvas({
  projectId,
  initialItems,
}: {
  projectId: string;
  initialItems: LineItem[];
}) {
  const [items, setItems] = useState<LineItem[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);
  // Trades start closed. `open` holds the ones the user opened.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync when the server re-renders (e.g. after a regenerate refresh).
  useEffect(() => setItems(initialItems), [initialItems]);

  const groups = useMemo(() => groupByTrade(items), [items]);
  // A single trade (a trade-only run) is open from the start — there is
  // nothing to skim past.
  const soloTrade = groups.length === 1 ? groups[0].trade : null;
  const isOpen = (trade: string) => open.has(trade) || trade === soloTrade;

  function toggle(trade: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(trade)) next.delete(trade);
      else next.add(trade);
      return next;
    });
  }

  // Apply an optimistic local change, run the server action, revert on failure.
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

  function patchLocal(id: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  }

  function onSetStatus(id: string, status: "proposed" | "confirmed" | "excluded") {
    run(
      () => patchLocal(id, { status }),
      () => setLineStatus(id, status),
    );
  }

  function onDelete(id: string) {
    run(
      () => setItems((prev) => prev.filter((li) => li.id !== id)),
      () => deleteLineItem(id),
    );
  }

  function onSaveEdit(id: string, fields: LineFields) {
    setEditingId(null);
    run(
      () => patchLocal(id, fields),
      () => updateLineItem(id, fields),
    );
  }

  function onAdd(group: { trade: string; rows: LineItem[] }, fields: LineFields) {
    setAddingIn(null);
    setError(null);
    // A hand-added line takes its CSI division from the trade it is added
    // under (the first line already there), so the Cost Database still has
    // something to key on.
    const sibling = group.rows[0];
    const division_code = sibling?.division_code ?? null;
    const division_name = sibling?.division_name ?? null;
    startTransition(async () => {
      const res = await addLineItem(projectId, {
        division_code,
        division_name,
        trade_package: group.trade,
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
          division_code,
          division_name,
          section_code: null,
          section_name: null,
          trade_package: group.trade,
          trade_sequence: null,
          ...fields,
          source_kind: "takeoff",
          confidence: "high",
          status: "confirmed",
          evidence: null,
          sort_order: 999,
        },
      ]);
    });
  }

  const allOpen = groups.every((g) => isOpen(g.trade));

  return (
    <div className="mt-6 space-y-3">
      {error ? (
        <p className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}

      {groups.length > 1 ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.trade)))}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      ) : null}

      {groups.map((g) => {
        const opened = isOpen(g.trade);
        const active = g.rows.filter((r) => r.status !== "excluded");
        const confirmed = active.filter((r) => r.status === "confirmed").length;
        const excludedCount = g.rows.length - active.length;
        return (
          <section key={g.trade} className="glass rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => toggle(g.trade)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-expanded={opened}
              >
                <Caret open={opened} className="shrink-0 text-muted" />
                {/* Wraps rather than truncates: on a phone "Concrete & Founda…" is not a heading. */}
                <h2 className="min-w-0 font-heading text-base leading-tight text-foreground">{g.trade}</h2>
                <span className="ml-auto shrink-0 text-right text-[11px] text-muted tabular-nums">
                  {active.length} {active.length === 1 ? "item" : "items"}
                  {confirmed ? ` · ${confirmed} confirmed` : ""}
                  {excludedCount ? ` · ${excludedCount} excluded` : ""}
                </span>
              </button>
              {opened ? (
                <button
                  type="button"
                  onClick={() => setAddingIn(addingIn === g.trade ? null : g.trade)}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-foreground"
                >
                  + Add Item
                </button>
              ) : null}
            </div>

            {opened ? (
              <div className="mt-2 divide-y divide-border">
                {g.rows.map((li) =>
                  editingId === li.id ? (
                    <EditRow
                      key={li.id}
                      item={li}
                      onCancel={() => setEditingId(null)}
                      onSave={(f) => onSaveEdit(li.id, f)}
                    />
                  ) : (
                    <Row
                      key={li.id}
                      item={li}
                      onEdit={() => setEditingId(li.id)}
                      onConfirm={() =>
                        onSetStatus(
                          li.id,
                          li.status === "confirmed" ? "proposed" : "confirmed",
                        )
                      }
                      onExclude={() => onSetStatus(li.id, "excluded")}
                      onRestore={() => onSetStatus(li.id, "proposed")}
                      onDelete={() => onDelete(li.id)}
                    />
                  ),
                )}
                {addingIn === g.trade ? (
                  <EditRow
                    adding
                    item={{
                      description: "",
                      deliverable: null,
                      includes: null,
                      excludes: null,
                      quantity: null,
                      unit: null,
                    }}
                    onCancel={() => setAddingIn(null)}
                    onSave={(f) => onAdd(g, f)}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** The CSI cost-code line under a deliverable: "22 40 00 · Plumbing Fixtures". */
function codeLine(li: LineItem): string {
  return [li.section_code, li.section_name ?? li.division_name].filter(Boolean).join(" · ");
}

function Row({
  item: li,
  onEdit,
  onConfirm,
  onExclude,
  onRestore,
  onDelete,
}: {
  item: LineItem;
  onEdit: () => void;
  onConfirm: () => void;
  onExclude: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const excluded = li.status === "excluded";
  const confirmed = li.status === "confirmed";
  // One compact line per item: the deliverable (or, for a line drafted before
  // the trade layer existed, the CSI label). Includes / excludes, the math,
  // source and assumptions live behind a ▸ expand.
  const [open, setOpen] = useState(false);
  const headline = li.deliverable?.trim() || li.description;
  // When the deliverable is the headline, the CSI label is the sub-line; when
  // there is no deliverable, the code alone is enough.
  const sub = li.deliverable?.trim()
    ? [li.section_code, li.description].filter(Boolean).join(" · ")
    : codeLine(li);
  const hasDetail = !!(
    li.includes ||
    li.excludes ||
    li.evidence?.formula ||
    li.evidence?.assumptions?.length ||
    li.source_kind ||
    li.confidence
  );
  const lowConf = li.confidence === "low";
  const actionBtn =
    "rounded px-1.5 py-0.5 transition-colors text-muted hover:bg-foreground/5 hover:text-foreground";

  // Touch: swipe left for Exclude / Delete (Restore / Delete when excluded);
  // hold for every action. The buttons below stay as the visible fallback.
  const swipe = excluded
    ? [
        { label: "Restore", onClick: onRestore },
        { label: "Delete", onClick: onDelete, tone: "danger" as const },
      ]
    : [
        { label: "Exclude", onClick: onExclude },
        { label: "Delete", onClick: onDelete, tone: "danger" as const },
      ];
  const sheet = excluded
    ? swipe
    : [
        {
          label: confirmed ? "Undo confirm" : "Confirm",
          onClick: onConfirm,
          tone: "primary" as const,
        },
        { label: "Edit", onClick: onEdit },
        ...swipe,
      ];

  return (
    <SwipeRow actions={swipe} sheetActions={sheet}>
      <div className={`group py-1.5 ${excluded ? "opacity-50" : ""}`}>
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            className={`mt-0.5 w-4 shrink-0 text-center text-[11px] text-muted transition-colors hover:text-foreground ${
              hasDetail ? "" : "invisible"
            }`}
          >
            <Caret open={open} size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <p
              onClick={excluded ? undefined : onEdit}
              title={excluded ? undefined : "Click to edit"}
              className={`text-sm text-foreground ${
                excluded ? "line-through" : "cursor-text hover:text-brand-soft"
              }`}
            >
              {confirmed ? <span className="mr-1 text-green-400">✓</span> : null}
              {headline}
            </p>
            {sub ? <p className="truncate text-[11px] text-muted/80">{sub}</p> : null}
          </div>
          {lowConf && !excluded ? (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${CONF.low ?? "bg-white/10 text-muted"}`}
            >
              low confidence
            </span>
          ) : null}
          <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted sm:w-24">
            {li.quantity != null ? `${li.quantity} ${li.unit ?? ""}` : "—"}
          </span>
          {/* Actions: desktop = fixed column, shown on hover / keyboard focus /
              when expanded. Phone (no hover) = wraps under the row, only when
              expanded, so the description keeps its width. */}
          <div
            className={`basis-full items-center justify-end gap-0.5 text-[11px] transition-opacity sm:w-40 sm:basis-auto sm:shrink-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 pointer-coarse:sm:opacity-100 ${
              open ? "flex" : "hidden sm:flex sm:opacity-0"
            }`}
          >
            {excluded ? (
              <>
                <button type="button" onClick={onRestore} className={actionBtn}>
                  Restore
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-brand/15 hover:text-brand-soft"
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onConfirm}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    confirmed
                      ? "text-green-400 hover:bg-green-500/10 hover:text-green-300"
                      : "text-muted hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  {confirmed ? "Undo" : "Confirm"}
                </button>
                <button type="button" onClick={onEdit} className={actionBtn}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onExclude}
                  className="rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-brand/15 hover:text-brand-soft"
                >
                  Exclude
                </button>
              </>
            )}
          </div>
        </div>

        {open ? (
          <div className="ml-6 mt-1 space-y-1 text-[11px] text-muted">
            {li.includes ? (
              <p>
                <span className="text-foreground/80">Includes:</span> {li.includes}
              </p>
            ) : null}
            {li.excludes ? (
              <p>
                <span className="text-foreground/80">Excludes:</span> {li.excludes}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              {li.confidence ? (
                <span
                  className={`rounded px-1.5 py-0.5 ${CONF[li.confidence] ?? "bg-white/10 text-muted"}`}
                >
                  {li.confidence} confidence
                </span>
              ) : null}
              {li.source_kind ? (
                <span className="rounded bg-white/10 px-1.5 py-0.5">{li.source_kind}</span>
              ) : null}
              {li.evidence?.formula ? <span>· {li.evidence.formula}</span> : null}
            </div>
            {li.evidence?.assumptions?.length ? (
              <p className="text-muted/80">Assumes: {li.evidence.assumptions.join("; ")}</p>
            ) : null}
            {li.deliverable?.trim() ? (
              <p className="text-muted/70">Cost code: {codeLine(li) || "—"} · filed under {tradeOf(li)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </SwipeRow>
  );
}

function EditRow({
  item,
  adding = false,
  onCancel,
  onSave,
}: {
  item: LineFields;
  adding?: boolean;
  onCancel: () => void;
  onSave: (f: LineFields) => void;
}) {
  const [deliverable, setDeliverable] = useState(item.deliverable ?? "");
  const [description, setDescription] = useState(item.description);
  const [includes, setIncludes] = useState(item.includes ?? "");
  const [excludes, setExcludes] = useState(item.excludes ?? "");
  const [quantity, setQuantity] = useState(qtyToInput(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "");

  // A hand-added line needs one name; the deliverable doubles as the CSI
  // label when the user only fills the first box.
  const canSave = !!(deliverable.trim() || description.trim());

  function save() {
    if (!canSave) return;
    onSave({
      deliverable: deliverable.trim() || null,
      description: description.trim() || deliverable.trim(),
      includes: includes.trim() || null,
      excludes: excludes.trim() || null,
      quantity: parseQty(quantity),
      unit: unit.trim() || null,
    });
  }

  const field =
    "w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand";

  return (
    <div className="space-y-1.5 py-2.5">
      <input
        type="text"
        value={deliverable}
        onChange={(e) => setDeliverable(e.target.value)}
        placeholder={adding ? "What gets delivered — e.g. Second-floor wall and roof framing" : "What gets delivered (what the client reads)"}
        autoFocus
        spellCheck
        className={field}
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="CSI label for cost-coding — e.g. Wood Framing — walls, floors & roof"
        spellCheck
        className={`${field} text-xs`}
      />
      <div className="grid gap-1.5 sm:grid-cols-2">
        <textarea
          value={includes}
          onChange={(e) => setIncludes(e.target.value)}
          placeholder="Includes — what this line covers"
          rows={2}
          spellCheck
          className={`${field} text-xs`}
        />
        <textarea
          value={excludes}
          onChange={(e) => setExcludes(e.target.value)}
          placeholder="Excludes — what it deliberately leaves out"
          rows={2}
          spellCheck
          className={`${field} text-xs`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
            disabled={!canSave}
            className="glass-brand rounded-md px-3 py-1 font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
          >
            {adding ? "Add" : "Save"}
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
