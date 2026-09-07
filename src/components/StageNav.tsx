"use client";

/**
 * The project's stage navigation, shared by the sidebar rail, the phone bottom
 * bar, and the takeoff viewer's "Go to" sheet — one list of icons and links so
 * every surface agrees on what the stages are.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

export type Icon = (props: { className?: string }) => React.ReactElement;
const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;

export const FolderIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);
export const DatabaseIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);
export const SettingsIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const LogoutIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
  </svg>
);
// Stage icons
export const FileIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const RulerIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M3 17l14-14 4 4L7 21H3v-4z" />
    <path d="M9 11l2 2M12 8l2 2M6 14l2 2" />
  </svg>
);
export const ListIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
  </svg>
);
export const DollarIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 3 5 3 5 1.1 5 3-2.2 3.5-5 3.5-5-1.6-5-3.5" />
  </svg>
);
export const CalcIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeLinecap="round" />
  </svg>
);
export const DocIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M8 13h8M8 17h5" strokeLinecap="round" />
  </svg>
);
const GridIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <rect x="4" y="4" width="6" height="6" rx="1.2" />
    <rect x="14" y="4" width="6" height="6" rx="1.2" />
    <rect x="4" y="14" width="6" height="6" rx="1.2" />
    <rect x="14" y="14" width="6" height="6" rx="1.2" />
  </svg>
);

export type StageKey = "plans" | "takeoff" | "scope" | "pricing" | "estimate" | "proposal";

/** The six stages of a project, in pipeline order, with their links. */
export function projectStages(
  projectId: string,
  firstPlanId?: string | null,
): { key: StageKey; label: string; href: string; icon: Icon }[] {
  const base = `/projects/${projectId}`;
  return [
    { key: "plans", label: "Plans", href: base, icon: FileIcon },
    {
      key: "takeoff",
      label: "Takeoff",
      href: firstPlanId ? `${base}/plans/${firstPlanId}` : base,
      icon: RulerIcon,
    },
    { key: "scope", label: "Scope", href: `${base}/scope`, icon: ListIcon },
    { key: "pricing", label: "Pricing", href: `${base}/pricing`, icon: DollarIcon },
    { key: "estimate", label: "Estimate", href: `${base}/estimate`, icon: CalcIcon },
    { key: "proposal", label: "Proposal", href: `${base}/proposal`, icon: DocIcon },
  ];
}

/**
 * "Go to" — the takeoff viewer's way to the rest of the app on a phone, where
 * the rail and the bottom tab bar are hidden so the drawing gets the screen.
 * A button in the viewer's bottom bar opens a bottom sheet listing every stage
 * plus Projects; a tap navigates, a tap on the backdrop closes it.
 */
export default function StageJump({
  projectId,
  className = "",
}: {
  projectId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const stages = projectStages(projectId).filter((s) => s.key !== "takeoff");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Go to another part of the app"
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:border-brand ${className}`}
      >
        <GridIcon className="h-4 w-4" />
        Go to
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Go to"
            className="glass-strong pb-safe w-full max-w-sm rounded-t-2xl p-2 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted">
              This project
            </p>
            <div className="grid grid-cols-1">
              {stages.map((s) => {
                const Ico = s.icon;
                return (
                  <Link
                    key={s.key}
                    href={s.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm text-foreground transition-colors hover:bg-white/10"
                  >
                    <Ico className="h-5 w-5 text-brand-soft" />
                    {s.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-1 border-t border-white/10 pt-1">
              <Link
                href="/projects"
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm text-foreground transition-colors hover:bg-white/10"
              >
                <FolderIcon className="h-5 w-5 text-muted" />
                All projects
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-1 flex min-h-11 w-full items-center justify-center rounded-lg text-sm text-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
