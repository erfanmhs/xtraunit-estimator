"use client";

/**
 * The project list, with iOS-style "hold → jiggle → drag to reorder" on top
 * (feedback A2/A3).
 *
 * The cards themselves are still server-rendered — they arrive here as
 * ready-made elements keyed by project id — so no project data or formatting
 * crosses into the client bundle. This component only owns the ORDER, the
 * edit mode, and the drag.
 *
 * How it works, in the order it happens:
 *   1. Hold a card (the action sheet) → "Reorder projects", or tap Reorder at
 *      the top of the list. Every card starts to jiggle and stops being a
 *      link.
 *   2. Put a finger on a card and drag. The card follows the finger; the
 *      others slide out of its way (a FLIP animation, so a CSS-grid reflow
 *      animates instead of jumping).
 *   3. Lift. The new order is saved right away — leaving the page a second
 *      later must not lose it.
 *   4. Tap anywhere that is not a card, tap Done, or press Escape to stop.
 *
 * Archived projects sit under a collapsed "Archived" heading at the bottom,
 * out of the way but one tap from coming back.
 */
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Caret from "@/components/Caret";
import { moveItem, sameOrder, slotAt, type Rect } from "@/lib/projects/reorder";
import { reorderProjects } from "./actions";

export type GridItem = { id: string; node: ReactNode };

const ReorderContext = createContext<{ editing: boolean; start: () => void }>({
  editing: false,
  start: () => {},
});
/** Cards read this to offer "Reorder projects" and to go inert while editing. */
export function useReorder() {
  return useContext(ReorderContext);
}

/** Finger has to travel this far before a press becomes a drag (a jiggling card is still tappable). */
const DRAG_SLOP = 6;

type Drag = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  origin: Rect; // where the card sat when the finger landed
  moved: boolean;
  x: number; // last known finger position
  y: number;
};

export default function ProjectGrid({
  items,
  archived,
}: {
  items: GridItem[];
  archived: GridItem[];
}) {
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.id));
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // The server may hand us a different list (a project archived, deleted,
  // duplicated, or the page revalidated after a save). Trust it, but only when
  // the SET of ids changed — otherwise a save's own revalidation would snap
  // the list back to the server's order mid-drag.
  // (Adjusted during render, the way React recommends for "reset state when a
  // prop changes", rather than in an effect that would paint the stale list
  // for a frame first.)
  const serverIds = items.map((i) => i.id).join("|");
  const [seenIds, setSeenIds] = useState(serverIds);
  if (seenIds !== serverIds) {
    setSeenIds(serverIds);
    const ids = serverIds ? serverIds.split("|") : [];
    const same = order.length === ids.length && order.every((id) => ids.includes(id));
    if (!same) setOrder(ids);
  }

  const byId = new Map(items.map((i) => [i.id, i.node]));
  const gridRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const rects = useRef(new Map<string, Rect>());
  const lastSaved = useRef<string[]>(order);
  const drag = useRef<Drag | null>(null);

  const measure = useCallback(() => {
    rects.current = new Map();
    cardEls.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      rects.current.set(id, { left: r.left, top: r.top, width: r.width, height: r.height });
    });
  }, []);

  // The dragged card follows the finger. Its DOM slot moves whenever the
  // order changes, so the translation is finger travel corrected by how far
  // the slot itself has moved.
  function pinDragged(el: HTMLDivElement, d: Drag, now: Rect) {
    const dx = d.x - d.startX + (d.origin.left - now.left);
    const dy = d.y - d.startY + (d.origin.top - now.top);
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
  }

  // FLIP: after the order changes, every card that is not being dragged
  // animates from where it was to where it is now, and the dragged card is
  // re-pinned under the finger.
  useLayoutEffect(() => {
    const before = rects.current;
    measure();
    const d = drag.current;
    rects.current.forEach((after, id) => {
      const el = cardEls.current.get(id);
      const prev = before.get(id);
      if (!el || !prev) return;
      if (d && id === d.id) {
        pinDragged(el, d, after);
        return;
      }
      const dx = prev.left - after.left;
      const dy = prev.top - after.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // flush, so the next line animates
      el.style.transition = "transform 180ms ease-out";
      el.style.transform = "";
    });
  }, [order, measure]);

  const save = useCallback((ids: string[]) => {
    if (sameOrder(ids, lastSaved.current)) return;
    lastSaved.current = ids;
    startTransition(() => {
      void reorderProjects(ids);
    });
  }, []);

  // Leaving edit mode always lands every card back in its slot, whatever
  // state a drag was left in — a lift the browser swallowed, a card still
  // pinned under a finger that is gone. Belt and braces for the phone.
  const stop = useCallback(() => {
    setEditing(false);
    setDragId(null);
    drag.current = null;
    cardEls.current.forEach((el) => {
      el.style.transition = "transform 160ms ease-out";
      el.style.transform = "";
    });
  }, []);

  // A drag ends on the FIRST of: pointer up on the card, the browser
  // cancelling the pointer (a scroll or a system gesture took it), the
  // capture being lost, or the page being hidden. Any of those without the
  // card's own handler firing used to leave it floating over the others.
  const endDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragId(null);
    const el = cardEls.current.get(d.id);
    if (el) {
      el.style.transition = "transform 160ms ease-out";
      el.style.transform = "";
    }
    if (d.moved) save(order);
  }, [save, order]);

  useEffect(() => {
    if (!editing) return;
    const end = () => endDrag();
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    document.addEventListener("visibilitychange", end);
    return () => {
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      document.removeEventListener("visibilitychange", end);
    };
  }, [editing, endDrag]);

  // Tap anywhere that is not a card (or Escape) leaves edit mode.
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      if (gridRef.current?.contains(e.target as Node)) return;
      stop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [editing, stop]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, id: string) {
    if (!editing || drag.current) return;
    if (e.button !== 0) return;
    measure();
    const origin = rects.current.get(id);
    if (!origin) return;
    drag.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin,
      moved: false,
      x: e.clientX,
      y: e.clientY,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers refuse capture for a pointer they consider gone; the
      // drag still works because the events keep arriving on the grid.
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved) {
      if (Math.abs(d.x - d.startX) < DRAG_SLOP && Math.abs(d.y - d.startY) < DRAG_SLOP) return;
      d.moved = true;
      setDragId(d.id);
    }
    const el = cardEls.current.get(d.id);
    const now = rects.current.get(d.id);
    if (el && now) pinDragged(el, d, now);

    // Which slot is the finger over? Move the card there; the layout effect
    // animates everyone else out of the way.
    const from = order.indexOf(d.id);
    const slotRects = order.map((id) => rects.current.get(id)).filter((r): r is Rect => !!r);
    if (slotRects.length !== order.length) return;
    const slot = slotAt({ x: d.x, y: d.y }, slotRects);
    if (slot !== null && slot !== from) setOrder(moveItem(order, from, slot));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    endDrag();
  }

  const ctx = { editing, start: () => setEditing(true) };

  return (
    <ReorderContext.Provider value={ctx}>
      {items.length > 0 ? (
        <div className="mb-3 flex items-center justify-end gap-3">
          {editing ? (
            <p className="mr-auto text-sm text-muted">Drag the cards into the order you want.</p>
          ) : null}
          <button
            type="button"
            onClick={() => (editing ? stop() : setEditing(true))}
            className={
              editing
                ? "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
                : "rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand-soft"
            }
          >
            {editing ? "Done" : "Reorder"}
          </button>
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted">Every project is archived. Open the list below to bring one back.</p>
      )}

      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        // While editing, a tap on a card must not open it.
        onClickCapture={(e) => {
          if (editing) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {order.map((id, i) => {
          const node = byId.get(id);
          if (!node) return null;
          const dragging = dragId === id;
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) cardEls.current.set(id, el);
                else cardEls.current.delete(id);
              }}
              // touch-surface: no iOS link preview / callout on the hold that
              // starts a drag.
              className={`${editing ? "jiggle touch-surface cursor-grab select-none" : ""} ${
                dragging ? "relative z-20 cursor-grabbing" : ""
              }`}
              style={
                editing
                  ? {
                      touchAction: "none",
                      animationDelay: `${(i % 4) * -70}ms`,
                      animationPlayState: dragging ? "paused" : "running",
                    }
                  : undefined
              }
              onPointerDown={(e) => onPointerDown(e, id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onLostPointerCapture={onPointerUp}
              // A card is a link, and a mouse dragging a link starts the
              // browser's own drag-and-drop, which cancels our pointer stream.
              onDragStart={(e) => {
                if (editing) e.preventDefault();
              }}
            >
              {node}
            </div>
          );
        })}
      </div>

      {archived.length > 0 ? (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            <Caret open={showArchived} />
            Archived
            <span className="rounded-full border border-border px-2 text-xs">{archived.length}</span>
          </button>
          {showArchived ? (
            <div className="mt-3 grid grid-cols-1 gap-4 opacity-80 sm:grid-cols-2 xl:grid-cols-3">
              {archived.map((a) => (
                <div key={a.id}>{a.node}</div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </ReorderContext.Provider>
  );
}
