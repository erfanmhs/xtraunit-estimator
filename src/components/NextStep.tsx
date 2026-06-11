import Link from "next/link";

/**
 * "Move to the next step" — the workflow walks Plans → Scope → Pricing →
 * Estimate → Proposal. Shown upper-right on each step's page.
 */
export default function NextStep({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand-soft transition-colors hover:bg-brand/25 hover:text-foreground"
    >
      Next step: {label} <span aria-hidden>→</span>
    </Link>
  );
}
