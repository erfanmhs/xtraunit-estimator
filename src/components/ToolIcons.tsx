"use client";

/**
 * Icons for the takeoff viewer's tools — one 24×24 stroke glyph each, so the
 * toolbar can be a grid of same-sized buttons on a phone (a label under each)
 * and a compact icon + label row on wider screens.
 */
export type ToolIconProps = { className?: string };
const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const SelectIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M5 3l14 8-6 1.5L10 19 5 3z" />
  </svg>
);
export const PanIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8.5a5.5 5.5 0 0 1-5.5 5.5H11a5 5 0 0 1-4.2-2.3L4.4 14a1.4 1.4 0 0 1 2.2-1.7L8 14V11" />
  </svg>
);
export const LineIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M5 19L19 5" />
    <circle cx="5" cy="19" r="1.6" fill="currentColor" />
    <circle cx="19" cy="5" r="1.6" fill="currentColor" />
  </svg>
);
export const AreaIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M5 8l8-4 6 5-3 10-10-2z" fill="currentColor" fillOpacity={0.18} />
  </svg>
);
export const CountIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <circle cx="7" cy="7" r="2.2" fill="currentColor" />
    <circle cx="17" cy="9" r="2.2" fill="currentColor" />
    <circle cx="10" cy="17" r="2.2" fill="currentColor" />
    <path d="M15.5 15.5h5M18 13v5" />
  </svg>
);
export const PolylineIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M4 18l5-9 5 5 6-10" />
    <circle cx="4" cy="18" r="1.5" fill="currentColor" />
    <circle cx="9" cy="9" r="1.5" fill="currentColor" />
    <circle cx="14" cy="14" r="1.5" fill="currentColor" />
    <circle cx="20" cy="4" r="1.5" fill="currentColor" />
  </svg>
);
export const WallIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M3 8h18M3 12h18M3 16h18M8 8v4M14 8v4M11 12v4M17 12v4M5 16v4M3 4h18v16H3z" strokeWidth={1.4} />
  </svg>
);
export const VolumeIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </svg>
);
export const LeaderIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M4 20l8-8" />
    <path d="M4 20l1.5-5 3.5 3.5z" fill="currentColor" />
    <rect x="12" y="4" width="8" height="6" rx="1" />
    <path d="M14 7h4" />
  </svg>
);
export const CalibrateIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M3 15l12-12 6 6-12 12z" />
    <path d="M7 11l2 2M10 8l2 2M13 5l2 2" />
  </svg>
);
export const CropIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <path d="M7 3v14h14M3 7h14v14" />
  </svg>
);
export const MoreIcon = ({ className }: ToolIconProps) => (
  <svg viewBox="0 0 24 24" {...sw} className={className} aria-hidden>
    <circle cx="6" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="18" cy="12" r="1.6" fill="currentColor" />
  </svg>
);
