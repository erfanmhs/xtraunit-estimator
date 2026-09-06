"use client";

/**
 * The left navigation — a responsive rail.
 *
 *  - Wide screens (≥ lg): the familiar 240px menu with labels.
 *  - Narrow screens (tablet / phone / half-screen window): a slim 56px icon
 *    rail. Hovering it expands the labels as an overlay, so the page content
 *    never has to reflow around it.
 *  - The takeoff viewer (/plans/…) keeps the slim rail even on desktop — that
 *    screen needs every pixel for the drawing.
 *  - Inside a project, the rail also shows that project's six STAGES
 *    (Plans → Takeoff → Scope → Pricing → Estimate → Proposal) as tabs, each
 *    with a done / in-progress dot — one click between any two stages.
 *
 * Pure CSS breakpoints (no JS width checks) so there's no flash on load.
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import {
  getProjectProgress,
  type ProjectProgress,
  type StageState,
} from "@/app/(app)/projects/actions";

type Icon = (props: { className?: string }) => React.ReactElement;
const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;

const FolderIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);
const DatabaseIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);
const SettingsIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
const LogoutIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
  </svg>
);
// Stage icons
const FileIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5" />
  </svg>
);
const RulerIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M3 17l14-14 4 4L7 21H3v-4z" />
    <path d="M9 11l2 2M12 8l2 2M6 14l2 2" />
  </svg>
);
const ListIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
  </svg>
);
const DollarIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 3 5 3 5 1.1 5 3-2.2 3.5-5 3.5-5-1.6-5-3.5" />
  </svg>
);
const CalcIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeLinecap="round" />
  </svg>
);
const DocIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M8 13h8M8 17h5" strokeLinecap="round" />
  </svg>
);

const NAV: { href: string; label: string; icon: Icon }[] = [
  { href: "/projects", label: "Projects", icon: FolderIcon },
  { href: "/cost-database", label: "Cost Database", icon: DatabaseIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const DOT: Record<StageState, string> = {
  done: "bg-green-400",
  partial: "bg-amber-400",
  todo: "",
};

export default function AppSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  // Inside a project? (/projects/<uuid>/…) — never /projects/new.
  const projectId =
    pathname.match(/^\/projects\/([0-9a-f-]{36})(?=\/|$)/i)?.[1] ?? null;
  // The takeoff viewer keeps the rail slim at every size.
  const compact = pathname.includes("/plans/");

  // Stage progress for the tabs. Re-read whenever the route changes so the
  // dots keep up with the work you just did.
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  useEffect(() => {
    let live = true;
    if (!projectId) {
      setProgress(null);
      return;
    }
    getProjectProgress(projectId).then((p) => {
      if (live) setProgress(p);
    });
    return () => {
      live = false;
    };
  }, [projectId, pathname]);

  const flow = compact ? "w-14" : "w-14 lg:w-60";
  const label = `whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${
    compact ? "" : "lg:opacity-100"
  }`;
  const item = (active: boolean) =>
    `relative flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
      active
        ? "bg-brand/15 text-foreground"
        : "text-muted hover:bg-background hover:text-foreground"
    }`;

  const base = projectId ? `/projects/${projectId}` : "";
  const stages: {
    key: keyof Omit<ProjectProgress, "name" | "firstPlanId">;
    label: string;
    href: string;
    icon: Icon;
    active: boolean;
  }[] = projectId
    ? [
        { key: "plans", label: "Plans", href: base, icon: FileIcon, active: pathname === base },
        {
          key: "takeoff",
          label: "Takeoff",
          href: progress?.firstPlanId ? `${base}/plans/${progress.firstPlanId}` : base,
          icon: RulerIcon,
          active: pathname.startsWith(`${base}/plans/`),
        },
        { key: "scope", label: "Scope", href: `${base}/scope`, icon: ListIcon, active: pathname.startsWith(`${base}/scope`) },
        { key: "pricing", label: "Pricing", href: `${base}/pricing`, icon: DollarIcon, active: pathname.startsWith(`${base}/pricing`) },
        { key: "estimate", label: "Estimate", href: `${base}/estimate`, icon: CalcIcon, active: pathname.startsWith(`${base}/estimate`) },
        { key: "proposal", label: "Proposal", href: `${base}/proposal`, icon: DocIcon, active: pathname.startsWith(`${base}/proposal`) },
      ]
    : [];

  // ── Phones: a bottom tab bar (thumb-reachable) instead of the rail ────────
  // Outside a project: the three areas + Sign out. Inside one: the six stages,
  // with Projects as the way back. The takeoff viewer hides it (it has its own
  // bottom bar with a Back button) so the drawing gets the whole screen.
  const mobileItems: { key: string; label: string; href: string; icon: Icon; active: boolean; dot?: string }[] =
    projectId
      ? [
          { key: "home", label: "Projects", href: "/projects", icon: FolderIcon, active: false },
          ...stages.map((s) => ({
            key: s.key,
            label: s.label,
            href: s.href,
            icon: s.icon,
            active: s.active,
            dot: progress ? DOT[progress[s.key]] : "",
          })),
        ]
      : NAV.map((n) => ({
          key: n.href,
          label: n.label === "Cost Database" ? "Costs" : n.label,
          href: n.href,
          icon: n.icon,
          active: pathname === n.href || pathname.startsWith(`${n.href}/`),
        }));

  const mobileBar = compact ? null : (
    <nav
      aria-label="Main"
      className="glass-strong pb-safe order-last z-20 flex w-full shrink-0 items-stretch border-t border-border sm:hidden"
    >
      {mobileItems.map((m) => {
        const Ico = m.icon;
        return (
          <Link
            key={m.key}
            href={m.href}
            aria-current={m.active ? "page" : undefined}
            className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] transition-colors ${
              m.active ? "text-foreground" : "text-muted"
            }`}
          >
            <span className="relative">
              <Ico className={`h-6 w-6 ${m.active ? "text-brand-soft" : ""}`} />
              {m.dot ? (
                <span className={`absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background ${m.dot}`} aria-hidden />
              ) : null}
            </span>
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}
      {!projectId ? (
        <form action={signOut} className="flex min-w-0 flex-1">
          <button
            type="submit"
            className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] text-muted"
          >
            <LogoutIcon className="h-6 w-6" />
            <span>Sign out</span>
          </button>
        </form>
      ) : null}
    </nav>
  );

  return (
    <>
    {mobileBar}
    {/* The rail: from `sm` up. Phones use the bottom bar; on the viewer they
        get nothing but the drawing (its bottom bar has a Back button). */}
    <aside className={`group relative z-20 hidden shrink-0 sm:block ${flow}`}>
      <div
        className={`glass absolute inset-y-0 left-0 flex w-14 flex-col overflow-hidden border-r border-border transition-[width] duration-200 group-hover:w-60 ${
          compact ? "" : "lg:w-60"
        }`}
      >
        <div className="border-b border-border px-3 py-4">
          <Link
            href="/projects"
            aria-label="Go to dashboard"
            className="flex items-center gap-3 transition-opacity hover:opacity-80"
          >
            <span className="flex w-8 shrink-0 justify-center">
              <Image src="/logo-mark.svg" alt="XtraUnit" width={30} height={21} priority />
            </span>
            <span className={`font-heading text-lg text-foreground ${label}`}>
              Estimator
            </span>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto p-2">
          {NAV.map((n) => {
            const active =
              pathname === n.href || pathname.startsWith(`${n.href}/`);
            const Ico = n.icon;
            return (
              <Link key={n.href} href={n.href} title={n.label} className={item(active && !projectId)}>
                <span className="flex w-8 shrink-0 justify-center">
                  <Ico className="h-5 w-5" />
                </span>
                <span className={label}>{n.label}</span>
              </Link>
            );
          })}

          {projectId ? (
            <>
              <div className="mt-3 border-t border-border pt-3">
                <p
                  className={`truncate px-2 pb-1 text-[11px] uppercase tracking-wider text-muted ${label}`}
                  title={progress?.name ?? undefined}
                >
                  {progress?.name ?? "Project"}
                </p>
              </div>
              {stages.map((s) => {
                const Ico = s.icon;
                const dot = progress ? DOT[progress[s.key]] : "";
                return (
                  <Link key={s.key} href={s.href} title={s.label} className={item(s.active)}>
                    <span className="relative flex w-8 shrink-0 justify-center">
                      <Ico className="h-5 w-5" />
                      {dot ? (
                        <span
                          className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background ${dot}`}
                          aria-hidden
                        />
                      ) : null}
                    </span>
                    <span className={`flex-1 ${label}`}>{s.label}</span>
                    {dot ? (
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dot} ${label}`} aria-hidden />
                    ) : null}
                  </Link>
                );
              })}
            </>
          ) : null}
        </nav>

        <div className="border-t border-border p-2">
          {email ? (
            <p className={`truncate px-2 pb-2 text-xs text-muted ${label}`} title={email}>
              {email}
            </p>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground transition-colors hover:bg-background hover:text-brand-soft"
            >
              <span className="flex w-8 shrink-0 justify-center">
                <LogoutIcon className="h-5 w-5" />
              </span>
              <span className={label}>Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
    </>
  );
}
