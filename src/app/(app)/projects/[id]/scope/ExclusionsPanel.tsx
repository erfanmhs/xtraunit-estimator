"use client";

/**
 * "Exclusions on the proposal" — the exact list the client reads under
 * "Excluded / by others", shown on the Scope page so it can be trimmed
 * there. Every item says where it comes from and offers what makes sense
 * for that source:
 *
 *   excluded line        Edit (rename) · Restore (back into the scope) · Delete (the line, for good)
 *   line note            Edit · Delete (clears the note)
 *   AI exclusion finding Edit · Hide / Restore · Delete (for good)
 *   standard exclusion   Hide on this project / Restore · edit the wording in Settings
 *
 * Erfan, 2026-09-14: "a long list of exclusion items in the proposal … easy
 * to edit, restore, or permanently delete … see the exact list … adjust
 * them in the scope of work section."
 */
import { useState } from "react";
import Link from "next/link";
import type { ExclusionItem } from "@/lib/proposal/exclusions";

const btn = "rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-foreground";
const FIELD = "w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground";

const SOURCE_LABEL: Record<ExclusionItem["source"], string> = {
  line: "excluded line",
  note: "line note",
  finding: "AI finding",
  standard: "standard · Settings",
};

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

  const shown = items.filter((i) => !("hidden" in i) || !i.hidden);
  const hidden = items.filter((i) => "hidden" in i && i.hidden);
  const keyOf = (i: ExclusionItem) => (i.source === "standard" ? `std:${i.text}` : `${i.source}:${i.id}`);

  function startEdit(i: ExclusionItem) {
    setEditing(keyOf(i));
    setDraft(i.source === "note" ? i.note : i.text);
  }
  function saveEdit(i: ExclusionItem) {
    const t = draft.trim();
    setEditing(null);
    if (i.source === "line" && t) onEditLine(i.id, t);
    else if (i.source === "note") onEditNote(i.id, t || null);
    else if (i.source === "finding" && t) onEditFinding(i.id, t);
  }

  function row(i: ExclusionItem, isHidden: boolean) {
    const k = keyOf(i);
    const canEdit = i.source !== "standard";
    const isEditing = editing === k;
    return (
      <li key={k} className={`flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5 ${isHidden ? "opacity-60" : ""}`}>
        <div className="min-w-0 flex-1 basis-56">
          {isEditing ? (
            <div className="flex items-center gap-2">
              {i.source === "note" ? <span className="shrink-0 text-sm text-muted">{i.trade} —</span> : null}
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
            </div>
          ) : (
            <span className={`text-sm ${isHidden ? "line-through" : "text-foreground"}`}>{i.text}</span>
          )}
          <span className="ml-2 text-[11px] uppercase tracking-wide text-muted">{SOURCE_LABEL[i.source]}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isEditing ? (
            <>
              <button type="button" onClick={() => saveEdit(i)} className={`${btn} border-brand text-foreground`}>Save</button>
              <button type="button" onClick={() => setEditing(null)} className={btn}>Cancel</button>
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
                className={`${btn} border-brand text-brand-soft`}
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(null)} className={btn}>Keep</button>
            </>
          ) : (
            <>
              {canEdit && !isHidden ? (
                <button type="button" onClick={() => startEdit(i)} className={btn}>Edit</button>
              ) : null}
              {i.source === "line" ? (
                <button type="button" onClick={() => onRestoreLine(i.id)} className={btn} title="Back into the scope of work">Restore to scope</button>
              ) : null}
              {i.source === "finding" ? (
                <button type="button" onClick={() => onHideFinding(i.id, !isHidden)} className={btn}>{isHidden ? "Restore" : "Hide"}</button>
              ) : null}
              {i.source === "standard" ? (
                <button type="button" onClick={() => onHideStandard(i.text, !isHidden)} className={btn} title="Only on this project — the wording lives in Settings">
                  {isHidden ? "Restore" : "Hide here"}
                </button>
              ) : null}
              {i.source === "note" ? (
                <button type="button" onClick={() => onEditNote(i.id, null)} className={btn} title="Clears the note on the line; the line stays">Delete</button>
              ) : null}
              {i.source === "line" || i.source === "finding" ? (
                <button type="button" onClick={() => setConfirmDelete(k)} className={btn}>Delete</button>
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
        <span className="font-heading text-lg text-foreground">Exclusions on the proposal</span>
        <span className="ml-auto text-xs text-muted">
          {shown.length} shown{hidden.length ? ` · ${hidden.length} hidden` : ""}
        </span>
      </button>
      <p className="mt-1 text-xs text-muted">
        Exactly what the client reads under &ldquo;Excluded / by others&rdquo;, in this order. Edit the wording, put a
        line back into the scope, hide an item, or delete it for good.
      </p>
      {open ? (
        <>
          {shown.length ? (
            <ul className="mt-3 divide-y divide-border">{shown.map((i) => row(i, false))}</ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Nothing is excluded right now.</p>
          )}
          {hidden.length ? (
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-[11px] uppercase tracking-wide text-muted">Hidden — not on the proposal</p>
              <ul className="divide-y divide-border">{hidden.map((i) => row(i, true))}</ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            Standard exclusions come from{" "}
            <Link href="/settings" className="text-brand-soft hover:underline">
              Settings → Proposal profile
            </Link>
            ; hiding one here changes this project only.
          </p>
        </>
      ) : null}
    </section>
  );
}
