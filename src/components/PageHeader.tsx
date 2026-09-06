import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one page header every screen uses, so titles, actions, and spacing stop
 * drifting page to page.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ← back                                    [action] [⋯]   │
 *   │ Title                                                    │
 *   │ subtitle                                                 │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ controls — a full-width row for the big stuff (Generate, │
 *   │ Suggest prices) instead of cramming it into the corner   │
 *   └──────────────────────────────────────────────────────────┘
 *
 *  - `action`   the page's ONE primary action (e.g. "+ New project", "Next step").
 *  - `menu`     an overflow (⋯) for secondary / destructive things like Delete.
 *  - `controls` anything wide — rendered beneath, never in the corner.
 * Everything wraps cleanly at narrow widths.
 */
export default function PageHeader({
  back,
  title,
  subtitle,
  action,
  menu,
  controls,
  className = "",
}: {
  back?: { href: string; label: string };
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          {back ? (
            <Link
              href={back.href}
              className="text-xs text-muted transition-colors hover:text-brand-soft"
            >
              ← {back.label}
            </Link>
          ) : null}
          <h1 className={`font-heading text-2xl text-foreground ${back ? "mt-1" : ""}`}>
            {title}
          </h1>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action || menu ? (
          // On phones the action drops onto its own line under the title so
          // the title never gets squeezed into a two-word column.
          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
            {action}
            {menu}
          </div>
        ) : null}
      </div>
      {controls ? <div className="mt-4">{controls}</div> : null}
    </div>
  );
}
