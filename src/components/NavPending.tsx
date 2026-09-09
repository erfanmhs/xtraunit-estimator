"use client";

/**
 * The "this tap landed" marker for a navigation link.
 *
 * `useLinkStatus` reports the pending state of the `<Link>` it sits inside, so
 * the moment a stage is tapped the icon swaps for a spinner. Without it, a
 * slow stage looked like a tap that did nothing, and the natural reaction is
 * to tap again — which is exactly the double-navigation this prevents
 * (feedback E1 / E2).
 *
 * It must be rendered as a descendant of a `<Link>`; outside one, `pending` is
 * simply always false and the children render as normal.
 */
import { useLinkStatus } from "next/link";
import { Spinner } from "./StageSkeleton";

export default function NavPending({
  children,
  className = "",
}: {
  /** What to show when nothing is pending — normally the stage's icon. */
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : <>{children}</>;
}

/**
 * Marks the whole link as busy while it is navigating: dims it and turns off
 * pointer events, so a second tap cannot start a second navigation.
 */
export function PendingLinkBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-busy={pending || undefined}
      className={`contents ${pending ? "pointer-events-none opacity-60" : ""} ${className}`}
    >
      {children}
    </span>
  );
}
