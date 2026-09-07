"use client";

/**
 * iOS-style swipe row (Mail / Messages): on a touch screen, slide a row LEFT
 * to reveal its actions (Delete, Exclude…) and tap one; HOLD the row for an
 * action sheet listing everything it can do. Slide right or tap elsewhere to
 * close it. One row is open at a time.
 *
 * Mouse users see nothing new — the row's own visible buttons stay, on every
 * device. Nothing here is gesture-only; this is the fast path for a thumb.
 *
 * Vertical scrolling is left to the browser (`touch-action: pan-y`): the row
 * only claims the gesture once the finger has clearly moved sideways.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export type SwipeAction = {
  label: string;
  onClick: () => void;
  /** danger = garnet (Delete), primary = green (Confirm), neutral = grey. */
  tone?: "danger" | "primary" | "neutral";
};

// The row currently showing its actions — opening another closes it. Keyed by
// a per-instance token, NOT by the close function: `close` is a new identity
// on every render, so comparing functions made an open row think another row
// had opened and it closed itself on the next press — which swallowed the tap
// on its own Delete button. (A holder object, not a bare variable: React's
// purity lint allows mutating a property from an event handler, not
// reassigning a module binding.)
const openRow: { token: object | null; close: (() => void) | null } = {
  token: null,
  close: null,
};

const ACTION_W = 76; // px per revealed action

export default function SwipeRow({
  actions,
  sheetActions,
  children,
  className = "",
}: {
  /** Revealed by the swipe (right to left order: last = outermost). Keep to 2–3. */
  actions: SwipeAction[];
  /** The hold menu. Defaults to `actions`. */
  sheetActions?: SwipeAction[];
  children: ReactNode;
  className?: string;
}) {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const [offset, setOffset] = useState(0); // 0 … -width (px)
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: number; // offset when the finger landed
    axis: "x" | "y" | null;
  } | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable identity for this row instance (see openRow). useState, not a ref:
  // refs may not be read during render.
  const [token] = useState<object>(() => ({}));
  const width = actions.length * ACTION_W;
  const open = offset <= -width + 1;

  function cancelHold() {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  }
  function close() {
    setOffset(0);
    if (openRow.token === token) {
      openRow.token = null;
      openRow.close = null;
    }
  }
  // A row that unmounts while open (its layer was just deleted) must not stay
  // registered, or the next row's first press would call into it.
  useEffect(
    () => () => {
      if (openRow.token === token) {
        openRow.token = null;
        openRow.close = null;
      }
    },
    [token],
  );

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  if (!coarse || actions.length === 0) return <div className={className}>{children}</div>;

  const tone = (t: SwipeAction["tone"]) =>
    t === "danger"
      ? "bg-brand text-white"
      : t === "primary"
        ? "bg-green-600 text-white"
        : "bg-white/15 text-foreground";

  return (
    <>
      <div
        className={`touch-surface relative overflow-hidden ${className}`}
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          if (openRow.token && openRow.token !== token) openRow.close?.();
          gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: offset, axis: null };
          cancelHold();
          holdRef.current = setTimeout(() => {
            holdRef.current = null;
            if (gesture.current?.axis) return; // it became a slide / scroll
            gesture.current = null;
            setSheet(true);
          }, 450);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.axis) {
            if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
            g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            cancelHold();
            if (g.axis === "x") setDragging(true);
          }
          if (g.axis !== "x") return;
          setOffset(Math.max(-width, Math.min(0, g.start + dx)));
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          cancelHold();
          if (!g || g.id !== e.pointerId) return;
          gesture.current = null;
          setDragging(false);
          if (g.axis !== "x") return;
          const dx = e.clientX - g.x;
          const next = g.start + dx;
          if (next < -width / 2) {
            setOffset(-width);
            openRow.token = token;
            openRow.close = close;
          } else close();
        }}
        onPointerCancel={() => {
          cancelHold();
          gesture.current = null;
          setDragging(false);
          if (!open) setOffset(0);
        }}
      >
        {/* The actions live in the strip the row uncovers as it slides left
            (clipped to exactly that width, so the row itself can stay
            transparent over the glass panel). */}
        <div
          className="absolute inset-y-0 right-0 flex justify-end overflow-hidden"
          style={{ width: Math.max(0, -offset) }}
          aria-hidden={!open}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                close();
                a.onClick();
              }}
              className={`flex shrink-0 items-center justify-center text-xs font-medium ${tone(a.tone)}`}
              style={{ width: ACTION_W }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div
          className="relative"
          style={{
            transform: `translateX(${offset}px)`,
            transition: dragging ? "none" : "transform 180ms ease-out",
          }}
          // Tapping an open row closes it instead of acting on it.
          onClickCapture={(e) => {
            if (open) {
              e.stopPropagation();
              e.preventDefault();
              close();
            }
          }}
        >
          {children}
        </div>
      </div>

      {/* Hold: the action sheet */}
      {sheet ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50"
          onClick={() => setSheet(false)}
        >
          <div
            role="dialog"
            aria-label="Actions"
            className="glass-strong pb-safe w-full max-w-sm rounded-t-2xl p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {(sheetActions ?? actions).map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  setSheet(false);
                  a.onClick();
                }}
                className={`flex min-h-12 w-full items-center rounded-lg px-4 text-left text-sm transition-colors hover:bg-white/10 ${
                  a.tone === "danger"
                    ? "text-brand-soft"
                    : a.tone === "primary"
                      ? "text-green-300"
                      : "text-foreground"
                }`}
              >
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSheet(false)}
              className="mt-1 flex min-h-11 w-full items-center justify-center rounded-lg border-t border-white/10 text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
