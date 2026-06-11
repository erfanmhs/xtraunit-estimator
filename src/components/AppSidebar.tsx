"use client";

/**
 * The left navigation rail shown on every signed-in page.
 * Highlights the active section, shows who's signed in, and the Sign out button.
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";

const NAV = [
  { href: "/projects", label: "Projects" },
  { href: "/cost-database", label: "Cost Database" },
  { href: "/settings", label: "Settings" },
];

export default function AppSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="glass relative flex w-60 shrink-0 flex-col border-r border-border">
      <div className="border-b border-border px-5 py-5">
        <Link
          href="/projects"
          aria-label="Go to dashboard"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <Image src="/logo-mark.svg" alt="XtraUnit" width={30} height={21} priority />
          <span className="font-heading text-lg text-foreground">Estimator</span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-brand/15 text-foreground"
                  : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        {email ? (
          <p className="truncate px-2 pb-2 text-xs text-muted" title={email}>
            {email}
          </p>
        ) : null}
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:border-brand hover:text-brand-soft"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
