/**
 * What a stage shows while it is loading.
 *
 * Moving between Plans → Scope → Pricing → Estimate → Proposal means fetching
 * a project's rows, and on a phone over cell data that is not instant. With
 * nothing on screen the app looked frozen, so people tapped again — which is
 * the double-run this is here to stop (feedback E1 / E2).
 *
 * Next renders this the instant a stage link is tapped, from `loading.tsx` in
 * each stage folder. It is deliberately the same shape as the real page — a
 * header, then stacked panels — so the layout does not jump when the content
 * lands.
 *
 * `aria-busy` and the live region tell a screen reader what the shimmer says
 * visually. `animate-pulse` respects prefers-reduced-motion via Tailwind.
 */
export default function StageSkeleton({
  title,
  rows = 4,
}: {
  /** The stage being opened, so the wait says what it is waiting for. */
  title: string;
  rows?: number;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="border-b border-border px-6 py-5 sm:px-8">
        <div className="h-3 w-24 rounded bg-muted/20" />
        <div className="mt-3 flex items-center gap-3">
          <h1 className="font-heading text-2xl text-foreground">{title}</h1>
          <Spinner />
        </div>
        <p className="mt-1 text-sm text-muted">Loading…</p>
      </div>

      <div className="flex flex-col gap-4 p-6 sm:p-8">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl panel p-5"
            // Each panel starts its pulse slightly later, so the page reads as
            // filling in rather than flashing as one block.
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <div className="h-4 w-40 rounded bg-muted/25" />
            <div className="mt-3 h-3 w-full max-w-md rounded bg-muted/15" />
            <div className="mt-2 h-3 w-2/3 max-w-sm rounded bg-muted/15" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      className={`animate-spin text-brand ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
