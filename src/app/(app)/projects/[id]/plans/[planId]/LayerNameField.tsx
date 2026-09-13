"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The layer-name field inside the picker.
 *
 * It deliberately keeps its own text state. `layer` lives on PlanViewer, and a
 * setState there re-renders the whole viewer — every SVG shape, the layer
 * totals, the measurements list — which on a phone made typing lag and drop
 * characters. The name is handed up only when it's COMMITTED (Done, Enter,
 * blur, or the picker closing), which is the only moment it has to be right.
 *
 * One rule it enforces: a layer holds one kind of measurement. `blocked`
 * lists the names on this sheet that already hold a different kind; such a
 * name is refused with a plain reason and never committed.
 */
export default function LayerNameField({
  initial,
  existing,
  blocked = {},
  toolNoun = "runs",
  selectOnMount = false,
  skipCommitRef,
  onCommit,
  onDone,
}: {
  initial: string;
  existing: string[];
  /** Layer name → what it already holds ("areas", "counts"…). Refused. */
  blocked?: Record<string, string>;
  /** What the current tool draws, for the refusal message: "counts". */
  toolNoun?: string;
  /** Open with the whole name selected, so typing replaces "Layer 3". */
  selectOnMount?: boolean;
  /** Set by the parent when a layer was picked from the list instead. */
  skipCommitRef: { current: boolean };
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(text);
  const commitRef = useRef(onCommit);
  const blockedRef = useRef(blocked);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  useEffect(() => {
    commitRef.current = onCommit;
    blockedRef.current = blocked;
  }, [onCommit, blocked]);
  useEffect(() => {
    if (selectOnMount) inputRef.current?.select();
  }, [selectOnMount]);
  // The picker can close without a blur (tap on the drawing) — commit then too,
  // unless the close came from picking an existing layer, or the name is refused.
  useEffect(
    () => () => {
      if (skipCommitRef.current) {
        skipCommitRef.current = false;
        return;
      }
      const name = latest.current.trim();
      if (!blockedRef.current[name]) commitRef.current(name);
    },
    [skipCommitRef],
  );

  const trimmed = text.trim();
  const holds = blocked[trimmed];
  const ok = !holds;
  const commit = () => {
    if (!ok) return;
    onCommit(trimmed);
    onDone();
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              if (ok) onCommit(trimmed);
              onDone();
            }
          }}
          onBlur={() => {
            if (ok) onCommit(trimmed);
          }}
          autoFocus={selectOnMount || !initial.trim()}
          spellCheck
          autoCapitalize="sentences"
          enterKeyHint="done"
          placeholder="New layer name (e.g. Exterior wall)"
          aria-label="Layer name"
          aria-invalid={!ok}
          className={`min-w-0 flex-1 rounded-md border bg-background px-2 py-2 text-foreground placeholder:text-muted/60 focus:outline-none ${
            ok ? "border-border focus:border-brand" : "border-brand"
          }`}
        />
        <button
          type="button"
          onClick={commit}
          disabled={!ok}
          className="glass-brand min-h-10 shrink-0 rounded-md px-3 font-medium text-foreground disabled:opacity-40"
        >
          Done
        </button>
      </div>
      <p className={`px-1 pt-1 text-[10px] ${ok ? "text-muted" : "text-brand-soft"}`}>
        {!ok
          ? `"${trimmed}" already holds ${holds} — ${toolNoun} need a layer of their own. Pick another name.`
          : trimmed
            ? existing.includes(trimmed)
              ? `Continuing "${trimmed}" — new runs add to it.`
              : `New layer "${trimmed}" — saved with the first run you draw.`
            : "Type a name for the runs you're about to draw, or pick a layer below."}
      </p>
    </>
  );
}
