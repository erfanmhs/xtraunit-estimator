/**
 * The expand / collapse marker.
 *
 * Every collapsible thing in the app used a text triangle (▸ / ▾) at
 * `text-xs`. At that size, on a phone, it does not read as a control at all —
 * it reads as punctuation, and people did not know the sections opened. This
 * is a real chevron at a real size (18 px by default), it rotates when open so
 * the state is legible while it moves, and it inherits `currentColor` so a
 * hovered or active header carries it along.
 *
 * Purely decorative: the button that wraps it carries the label and the
 * `aria-expanded`, so this is hidden from screen readers.
 */
export default function Caret({
  open,
  size = 18,
  className = "",
}: {
  open: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-150 ${
        open ? "rotate-90" : ""
      } ${className}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
