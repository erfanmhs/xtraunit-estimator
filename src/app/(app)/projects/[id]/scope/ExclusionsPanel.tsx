"use client";

/**
 * "Not included in this price" — the list the client reads, shown on the
 * Scope page so it can be trimmed where the scope is. Grouped the way it
 * prints: by trade first (what that trade's work leaves out, and any whole
 * item taken out of the bid), then what the AI's plan review noted, then
 * the company's standard list from Settings. One compact row per item.
 *
 * Erfan, 2026-09-14/15: the list is long — gather it so it takes less
 * room; "line note" meant nothing; use words a non-builder understands.
 */
import { useState } from "react";
import Link from "next/link";
import { groupExclusions, type ExclusionItem } from "@/lib/proposal/exclusions";

const link = "text-xs text-muted transition-colors hover:text-foreground";
const FIELD = "w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground";

export default function ExclusionsPanel({
  items,
  onEditLine,
  onRestoreLine,
  onDeleteLine,
  onEditNote,
  onEditFinding,
  onHideFinding,
  onDeleteFinding,
  onHideStandard,
}: {
  items: ExclusionItem[];
  onEditLine: (id: string, text: string) => void;
  onRestoreLine: (id: string) => void;
  onDeleteLine: (id: string) => void;
  onEditNote: (id: string, note: string | null) => void;
  onEditFinding: (id: string, text: string) => void;
  onHideFinding: (id: string, hidden: boolean) => void;
  onDeleteFinding: (id: string) => void;
  onHideStandard: (text: string, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const shownCount = items.filter((i) => !("hidden" in i) || !i.hidden).length;
  const hiddenCount = items.length - shownCount;
  const groups = groupExclusions(items);
  const keyOf = (i: ExclusionItem) => (i.source === "standard" ? `std:${i.text}` : `${i.source}:${i.id}`);

  function startEdit(i: ExclusionItem) {
    setEditing(keyOf(i));
    setDraft(i.short);
  }
  function saveEdit(i: ExclusionItem) {
    const t = draft.trim();
    setEditing(null);
    if (i.source === "line" && t) onEditLine(i.id, t);
    else if (i.source === "note") onEditNote(i.id, t || null);
    else if (i.source === "finding" && t) onEditFinding(i.id, t);
  }

  function row(i: ExclusionItem) {
    const k = keyOf(i);
    const isHidden = "hidden" in i && i.hidden;
    const isEditing = editing === k;
    const sep = <span className="text-border">·</span>;
    return (
      <li key={k} className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1 ${isHidden ? "opacity-60" : ""}`}>
        <div className="min-w-0 flex-1 basis-56 text-sm">
          {isEditing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit(i);
                if (e.key === "Escape") setEditing(null);
              }}
              spellCheck
              className={FIELD}
            />
          ) : (
            <>
              <span className={isHidden ? "line-through" : "text-foreground"}>{i.short}</span>
              {i.source === "line" ? (
                <span className="ml-2 text-xs text-muted">whole item, taken out of the bid</span>
              ) : null}
              {isHidden ? <span className="ml-2 text-xs text-muted">hidden</span> : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isEditing ? (
            <>
              <button type="button" onClick={() => saveEdit(i)} className="text-xs text-brand-soft hover:underline">Save</button>
              {sep}
              <button type="button" onClick={() => setEditing(null)} className={link}>Cancel</button>
            </>
          ) : confirmDelete === k ? (
            <>
              <span className="text-xs text-brand-soft">Delete for good?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(null);
                  if (i.source === "line") onDeleteLine(i.id);
                  else if (i.source === "finding") onDeleteFinding(i.id);
                }}
                className="text-xs text-brand-soft hover:underline"
              >
                Yes, delete
              </button>
              {sep}
              <button type="button" onClick={() => setConfirmDelete(null)} className={link}>Keep</button>
            </>
          ) : (
            <>
              {i.source !== "standard" && !isHidden ? (
                <button type="button" onClick={() => startEdit(i)} className={link}>Edit</button>
              ) : null}
              {i.source === "line" ? (
                <>
                  {sep}
                  <button type="button" onClick={() => onRestoreLine(i.id)} className={link} title="Put this item back into the scope of work">Put back in scope</button>
                </>
              ) : null}
              {i.source === "finding" ? (
                <>
                  {sep}
                  <button type="button" onClick={() => onHideFinding(i.id, !isHidden)} className={link}>{isHidden ? "Show again" : "Hide"}</button>
                </>
              ) : null}
              {i.source === "standard" ? (
                <button type="button" onClick={() => onHideStandard(i.text, !isHidden)} className={link} title="Only on this project — the wording lives in Settings">
                  {isHidden ? "Show again" : "Hide on this job"}
                </button>
              ) : null}
              {i.source === "note" ? (
                <>
                  {sep}
                  <button type="button" onClick={() => onEditNote(i.id, null)} className={link} title="Removes this note; the work item stays in the scope">Delete</button>
                </>
              ) : null}
              {i.source === "line" || i.source === "finding" ? (
                <>
                  {sep}
                  <button type="button" onClick={() => setConfirmDelete(k)} className={link}>Delete</button>
                </>
              ) : null}
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <section className="mt-6 rounded-xl panel p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className="font-heading text-lg text-foreground">Not included in this price</span>
        <span className="ml-auto text-xs text-muted">
          {shownCount} on the proposal{hiddenCount ? ` · ${hiddenCount} hidden` : ""}
        </span>
      </button>
      <p className="mt-1 text-xs text-muted">
        What the client will read as not included, grouped the way it prints. Under a trade: things that trade&apos;s
        work leaves out, and any whole item taken out of the bid. Fix the wording, put an item back into the scope,
        hide it, or delete it for good.
      </p>
      {open ? (
        <>
          {groups.length ? (
            <div className="mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2">
              {groups.map((g) => (
                <div key={g.title} className="break-inside-avoid">
                  <h3 className="border-b border-border pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    {g.title}
                  </h3>
                  <ul>{g.items.map((i) => row(i))}</ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Nothing is left out right now.</p>
          )}
          <p className="mt-3 text-xs text-muted">
            The standard list comes from{" "}
            <Link href="/settings" className="text-brand-soft hover:underline">
              Settings → Proposal profile
            </Link>
            ; hiding one here changes this job only.
          </p>
        </>
      ) : null}
    </section>
  );
}
