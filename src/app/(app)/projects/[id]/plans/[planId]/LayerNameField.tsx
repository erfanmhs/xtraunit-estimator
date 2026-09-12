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
 */
export default function LayerNameField({
  initial,
  existing,
  skipCommitRef,
  onCommit,
  onDone,
}: {
  initial: string;
  existing: string[];
  /** Set by the parent when a layer was picked from the list instead. */
  skipCommitRef: { current: boolean };
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const latest = useRef(text);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);
  // The picker can close without a blur (tap on the drawing) — commit then too,
  // unless the close came from picking an existing layer.
  useEffect(
    () => () => {
      if (skipCommitRef.current) {
        skipCommitRef.current = false;
        return;
      }
      commitRef.current(latest.current.trim());
    },
    [skipCommitRef],
  );

  const trimmed = text.trim();
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              onCommit(trimmed);
              onDone();
            }
          }}
          onBlur={() => onCommit(trimmed)}
          autoFocus={!initial.trim()}
          spellCheck
          autoCapitalize="sentences"
          enterKeyHint="done"
          placeholder="New layer name (e.g. Exterior wall)"
          aria-label="Layer name"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onCommit(trimmed);
            onDone();
          }}
          className="glass-brand min-h-10 shrink-0 rounded-md px-3 font-medium text-foreground"
        >
          Done
        </button>
      </div>
      <p className="px-1 pt-1 text-[10px] text-muted">
        {trimmed
          ? existing.includes(trimmed)
            ? `Continuing "${trimmed}" — new runs add to it.`
            : `New layer "${trimmed}" — saved with the first run you draw.`
          : "Type a name for the runs you're about to draw, or pick a layer below."}
      </p>
    </>
  );
}
