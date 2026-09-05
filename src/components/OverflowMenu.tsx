"use client";

/**
 * A "⋯" button that opens a small menu — the home for secondary and
 * destructive actions (Delete, etc.) so they stay out of the prime spot where a
 * page's main action belongs. Closes on outside click or Escape.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function OverflowMenu({
  children,
  label = "More actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="rounded-md border border-border px-2.5 py-1.5 text-sm leading-none text-muted transition-colors hover:border-brand hover:text-foreground"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="glass-strong absolute right-0 z-30 mt-1 min-w-[180px] rounded-lg p-1 text-sm"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A consistent row inside an OverflowMenu. `danger` styles it red. */
export function MenuItemStyle(danger?: boolean): string {
  return `block w-full rounded-md px-3 py-2 text-left transition-colors ${
    danger
      ? "text-brand-soft hover:bg-brand/15"
      : "text-foreground hover:bg-background"
  }`;
}
