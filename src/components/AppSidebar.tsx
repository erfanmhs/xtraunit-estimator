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
 *
 * Pure CSS breakpoints (no JS width checks) so there's no flash on load.
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";

type Icon = (props: { className?: string }) => React.ReactElement;

const FolderIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);
const DatabaseIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);
const SettingsIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
const LogoutIcon: Icon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
  </svg>
);

const NAV: { href: string; label: string; icon: Icon }[] = [
  { href: "/projects", label: "Projects", icon: FolderIcon },
  { href: "/cost-database", label: "Cost Database", icon: DatabaseIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function AppSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  // The takeoff viewer keeps the rail slim at every size.
  const compact = pathname.includes("/plans/");
  // Width the rail OCCUPIES in the page flow.
  const flow = compact ? "w-14" : "w-14 lg:w-60";
  // Labels show when the rail is expanded: on hover, or on wide screens (unless compact).
  const label = `whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${
    compact ? "" : "lg:opacity-100"
  }`;

  return (
    <aside className={`group relative z-20 shrink-0 ${flow}`}>
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

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Ico = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                  active
                    ? "bg-brand/15 text-foreground"
                    : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                <span className="flex w-8 shrink-0 justify-center">
                  <Ico className="h-5 w-5" />
                </span>
                <span className={label}>{item.label}</span>
              </Link>
            );
          })}
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
  );
}
