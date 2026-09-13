/**
 * Branding — the company's look on the app and on every proposal: logo,
 * brand colour, default theme, slogan and tagline, the voice the AI writes
 * in, and the kinds of jobs the company does. Stored as one JSON block on
 * company_settings.branding (migration 0044).
 *
 * Shared by server (layout, loader) and client (settings, welcome wizard,
 * proposal renderer): plain data and pure functions, no server imports.
 */

export type BrandTheme = "dark" | "light" | "system";
export type BrandVoice = "plain" | "warm" | "formal";

export type Branding = {
  /** A data: URL (PNG / JPEG / WebP), resized in the browser to ≤ 480 px. null = no logo. */
  logo: string | null;
  /** The brand colour as #rrggbb. Buttons, links and the proposal letterhead use it. */
  primary: string;
  theme: BrandTheme;
  slogan: string;
  tagline: string;
  voice: BrandVoice;
  /** Project types the company takes, from PROJECT_TYPES. */
  job_types: string[];
  /** When the welcome wizard was finished or skipped; null = show it. */
  onboarded_at: string | null;
};

/** The logo red the app shipped with. */
export const DEFAULT_PRIMARY = "#a01c2d";

export const DEFAULT_BRANDING: Branding = {
  logo: null,
  primary: DEFAULT_PRIMARY,
  theme: "dark",
  slogan: "",
  tagline: "",
  voice: "plain",
  job_types: [],
  onboarded_at: null,
};

export const VOICE_LABELS: Record<BrandVoice, string> = {
  plain: "Plain and direct",
  warm: "Warm and personal",
  formal: "Formal and precise",
};

/** Project types the company can say it takes — the same keys as PROJECT_TYPES. */
export const JOB_TYPE_LABELS: Record<string, string> = {
  residential: "Custom homes & remodels",
  adu_addition: "ADUs & additions",
  multifamily: "Multifamily",
  commercial: "Commercial & tenant improvements",
  trade_work: "Trade work (one trade, as a sub)",
  other: "Other",
};

/** How each voice reads, for the AI prompt and the settings hint. */
export const VOICE_GUIDE: Record<BrandVoice, string> = {
  plain: "short sentences, everyday words, no adjectives that don't earn their place; sounds like a builder explaining the job",
  warm: "friendly and first-person, speaks to the homeowner's life in the finished space, still specific about the work",
  formal: "measured and precise, third-person where natural, the register of a firm that bids institutional work",
};

const HEX = /^#[0-9a-f]{6}$/i;
export function isHexColor(s: string): boolean {
  return HEX.test(s.trim());
}

/** A logo must be a small raster data URL — nothing that can run or fetch. */
export function isLogoDataUrl(s: string): boolean {
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 400_000;
}

/** Read a stored branding block, tolerating anything older or missing. */
export function resolveBranding(raw: unknown): Branding {
  const b = (raw ?? {}) as Partial<Branding>;
  const primary = typeof b.primary === "string" && isHexColor(b.primary) ? b.primary.toLowerCase() : DEFAULT_PRIMARY;
  const theme: BrandTheme = b.theme === "light" || b.theme === "system" ? b.theme : "dark";
  const voice: BrandVoice = b.voice === "warm" || b.voice === "formal" ? b.voice : "plain";
  return {
    logo: typeof b.logo === "string" && isLogoDataUrl(b.logo) ? b.logo : null,
    primary,
    theme,
    slogan: String(b.slogan ?? "").trim().slice(0, 120),
    tagline: String(b.tagline ?? "").trim().slice(0, 200),
    voice,
    job_types: Array.isArray(b.job_types) ? b.job_types.map((t) => String(t)).filter(Boolean).slice(0, 12) : [],
    onboarded_at: typeof b.onboarded_at === "string" ? b.onboarded_at : null,
  };
}

// ── Colour math: one brand colour → the accent set the app's CSS expects ──

export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function withL(hex: string, l: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, l)) }));
}

export type AccentSet = { accent: string; strong: string; soft: string; on: string };

/**
 * The four accent tokens the app's CSS uses, derived from one brand colour
 * for a given theme. On a near-black ground the accent is lifted until it
 * reads as an action (≥ 4.5:1 against #0b0e14); on white it is deepened
 * until it holds against #ffffff. "on" is the text colour on an accent fill.
 */
export function accentSet(primary: string, theme: "dark" | "light"): AccentSet {
  const hex = isHexColor(primary) ? primary.toLowerCase() : DEFAULT_PRIMARY;
  const base = rgbToHsl(hexToRgb(hex));
  const ground = theme === "dark" ? "#0b0e14" : "#ffffff";
  // Walk lightness toward readable, in small steps, keeping hue and saturation.
  let l = base.l;
  let accent = hex;
  for (let i = 0; i < 40 && contrast(accent, ground) < 4.5; i++) {
    l += theme === "dark" ? 0.02 : -0.02;
    accent = withL(hex, l);
  }
  const strong = withL(accent, Math.max(0.08, l - 0.12));
  const soft = theme === "dark" ? withL(accent, Math.min(0.92, l + 0.14)) : withL(accent, Math.max(0.1, l - 0.06));
  const on = contrast(accent, "#ffffff") >= 3 ? "#ffffff" : "#111827";
  return { accent, strong, soft, on };
}

/** The CSS that re-points the app's accent tokens at the brand colour, both themes. */
export function brandCss(primary: string): string {
  const d = accentSet(primary, "dark");
  const l = accentSet(primary, "light");
  // :root[data-theme] matches globals.css's own selectors exactly, so this
  // wins on source order (it is emitted after the stylesheet), not luck.
  return `:root[data-theme="dark"]{--accent:${d.accent};--accent-strong:${d.strong};--accent-soft:${d.soft};--accent-on:${d.on}}:root[data-theme="light"]{--accent:${l.accent};--accent-strong:${l.strong};--accent-soft:${l.soft};--accent-on:${l.on}}`;
}
