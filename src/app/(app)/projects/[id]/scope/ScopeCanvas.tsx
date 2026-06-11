"use client";

/**
 * Editable scope canvas. Each AI-drafted line can be confirmed, edited, or
 * excluded; you can add your own lines too. Anything you touch is protected from
 * the next AI regenerate (the server sets user_edited = true). Excluded lines are
 * kept (dimmed + struck through) and can be restored or permanently removed.
 */
import { useEffect, useState, useTransition } from "react";
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

const CONF: Record<string, string> = {
  high: "bg-green-500/15 text-green-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-brand/20 text-brand-soft",
};

function divKey(li: { division_code: string | null; division_name: string | null }) {
  return `${li.division_code ?? "—"} · ${li.division_name ?? "Other"}`;
}

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
  const [addingDiv, setAddingDiv] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Re-sync when the server re-renders (e.g. after a regenerate refresh).
  useEffect(() => setItems(initialItems), [initialItems]);

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

  function onSaveEdit(
    id: string,
    fields: { description: string; quantity: number | null; unit: string | null },
  ) {
    setEditingId(null);
    run(
      () => patchLocal(id, fields),
      () => updateLineItem(id, fields),
    );
  }

  function onAdd(
    div: { division_code: string | null; division_name: string | null },
    fields: { description: string; quantity: number | null; unit: string | null },
  ) {
    setAddingDiv(null);
    setError(null);
    startTransition(async () => {
      const res = await addLineItem(projectId, {
        division_code: div.division_code,
        division_name: div.division_name,
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
          division_code: div.division_code,
          division_name: div.division_name,
          section_code: null,
          section_name: null,
          description: fields.description,
          quantity: fields.quantity,
          unit: fields.unit,
          source_kind: "takeoff",
          confidence: "high",
          status: "confirmed",
          evidence: null,
          sort_order: 999,
        },
      ]);
    });
  }

  // Group by division, preserving first-seen order.
  const groups: { key: string; code: string | null; name: string | null; rows: LineItem[] }[] =
    [];
  for (const li of items) {
    const key = divKey(li);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, code: li.division_code, name: li.division_name, rows: [] };
      groups.push(g);
    }
    g.rows.push(li);
  }

  // Within a division, sub-group by CSI section (06 10 00 Rough Carpentry…).
  // Lines without a section (e.g. hand-added) fall into an unlabeled group.
  function sectionGroups(rows: LineItem[]) {
    const out: { key: string; label: string | null; rows: LineItem[] }[] = [];
    for (const li of rows) {
      const hasSection = !!(li.section_code || li.section_name);
      const key = hasSection
        ? `${li.section_code ?? ""}|${li.section_name ?? ""}`
        : "__none";
      const label = hasSection
        ? [li.section_code, li.section_name].filter(Boolean).join(" — ")
        : null;
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label, rows: [] };
        out.push(g);
      }
      g.rows.push(li);
    }
    return out;
  }

  return (
    <div className="mt-6 space-y-6">
      {error ? (
        <p className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}

      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
        <section key={g.key} className="glass rounded-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => toggleCollapse(g.key)}
              className="flex min-w-0 items-center gap-2 text-left"
              aria-expanded={!isCollapsed}
            >
              <span className="text-xs text-muted">{isCollapsed ? "▸" : "▾"}</span>
              <h2 className="truncate font-heading text-sm uppercase tracking-wider text-brand-soft">
                {g.key}
              </h2>
              <span className="shrink-0 text-[11px] text-muted">
                {g.rows.length} lines
              </span>
            </button>
            {!isCollapsed ? (
              <button
                type="button"
                onClick={() => setAddingDiv(addingDiv === g.key ? null : g.key)}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-foreground"
              >
                + Add line
              </button>
            ) : null}
          </div>

          {!isCollapsed ? (
          <div className="mt-2 space-y-3">
            {sectionGroups(g.rows).map((sg) => (
              <div key={sg.key}>
                {sg.label ? (
                  <h3 className="mb-1 border-b border-white/10 pb-1 text-xs font-medium tracking-wide text-muted">
                    {sg.label}
                  </h3>
                ) : null}
                <div className="divide-y divide-white/5">
                  {sg.rows.map((li) =>
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
                </div>
              </div>
            ))}

            {addingDiv === g.key ? (
              <EditRow
                adding
                item={{
                  description: "",
                  quantity: null,
                  unit: null,
                }}
                onCancel={() => setAddingDiv(null)}
                onSave={(f) =>
                  onAdd(
                    { division_code: g.code, division_name: g.name },
                    f,
                  )
                }
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

  return (
    <div className={`group py-2.5 ${excluded ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p
          onClick={excluded ? undefined : onEdit}
          title={excluded ? undefined : "Click to edit"}
          className={`text-sm text-foreground ${excluded ? "line-through" : "cursor-text hover:text-brand-soft"}`}
        >
          {confirmed ? <span className="mr-1 text-green-400">✓</span> : null}
          {li.description}
        </p>
        <span className="shrink-0 whitespace-nowrap text-sm text-muted">
          {li.quantity != null ? `${li.quantity} ${li.unit ?? ""}` : "—"}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        {li.confidence ? (
          <span
            className={`rounded px-1.5 py-0.5 ${CONF[li.confidence] ?? "bg-white/10 text-muted"}`}
          >
            {li.confidence} confidence
          </span>
        ) : null}
        {li.source_kind ? (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-muted">
            {li.source_kind}
          </span>
        ) : null}
        {li.evidence?.formula ? (
          <span className="text-muted">· {li.evidence.formula}</span>
        ) : null}
      </div>
      {li.evidence?.assumptions?.length ? (
        <p className="mt-0.5 text-[11px] text-muted/80">
          Assumes: {li.evidence.assumptions.join("; ")}
        </p>
      ) : null}

      {/* Controls */}
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
        {excluded ? (
          <>
            <button
              type="button"
              onClick={onRestore}
              className="text-muted transition-colors hover:text-foreground"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="text-muted transition-colors hover:text-brand-soft"
            >
              Delete permanently
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onConfirm}
              className={`transition-colors ${
                confirmed
                  ? "text-green-400 hover:text-green-300"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {confirmed ? "Confirmed — undo" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="text-muted transition-colors hover:text-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onExclude}
              className="text-muted transition-colors hover:text-brand-soft"
            >
              Exclude
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EditRow({
  item,
  adding = false,
  onCancel,
  onSave,
}: {
  item: { description: string; quantity: number | null; unit: string | null };
  adding?: boolean;
  onCancel: () => void;
  onSave: (f: {
    description: string;
    quantity: number | null;
    unit: string | null;
  }) => void;
}) {
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(qtyToInput(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "");

  function save() {
    if (!description.trim()) return;
    onSave({
      description: description.trim(),
      quantity: parseQty(quantity),
      unit: unit.trim() || null,
    });
  }

  return (
    <div className="py-2.5">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={adding ? "New scope line…" : "Description"}
        autoFocus
        className="w-full rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          className="w-24 rounded-md border border-border bg-black/20 px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
        />
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="unit (sf, ea, lf…)"
          className="w-40 rounded-md border border-border bg-black/20 px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
        />
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={save}
            disabled={!description.trim()}
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
