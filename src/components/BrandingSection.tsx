"use client";

/**
 * The branding controls — logo, brand colour, default theme, slogan and
 * tagline, voice, kinds of jobs. Used twice: inside Settings and inside the
 * welcome wizard. It edits a Branding value and hands every change up; the
 * parent decides when to save.
 *
 * The logo is resized in the browser to ≤ 480 px on the long edge and kept
 * as a data URL, so it travels inside the proposal snapshot and shows on the
 * client's link without any file permission.
 */
import { useId, useRef, useState } from "react";
import {
  accentSet,
  isHexColor,
  JOB_TYPE_LABELS,
  VOICE_GUIDE,
  VOICE_LABELS,
  type BrandTheme,
  type BrandVoice,
  type Branding,
} from "@/lib/branding";

const LOGO_MAX_EDGE = 480;
const LOGO_MAX_BYTES = 350_000; // of base64 — the store caps at 400 K

/** File → small data URL. PNG keeps transparency; JPEG if PNG comes out too big. */
async function fileToLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file could not be read as an image."));
      i.src = url;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error("That image has no size.");
    const k = Math.min(1, LOGO_MAX_EDGE / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Could not draw the image.");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL("image/png");
    if (out.length > LOGO_MAX_BYTES) {
      ctx.fillStyle = "#fff"; // JPEG has no transparency — give it paper
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillRect(0, 0, c.width, c.height);
      out = c.toDataURL("image/jpeg", 0.85);
    }
    if (out.length > LOGO_MAX_BYTES) throw new Error("That logo is too detailed to store. Try a simpler PNG.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const FIELD =
  "w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand";
const LABEL = "text-[11px] uppercase tracking-wider text-muted";

export default function BrandingSection({
  value,
  onChange,
  compact = false,
}: {
  value: Branding;
  onChange: (next: Branding) => void;
  /** The wizard shows fewer words; Settings shows the full hints. */
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [hexText, setHexText] = useState(value.primary);
  const id = useId();
  const set = (patch: Partial<Branding>) => onChange({ ...value, ...patch });

  async function onLogoFile(f: File | null) {
    if (!f) return;
    setLogoError(null);
    try {
      set({ logo: await fileToLogo(f) });
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Could not use that file.");
    }
  }

  const dark = accentSet(value.primary, "dark");
  const light = accentSet(value.primary, "light");

  return (
    <div className="space-y-5">
      {/* Logo */}
      <div>
        <span className={LABEL}>Logo</span>
        {!compact ? (
          <p className="text-xs text-muted/70">
            Shows at the top of the app and on the proposal letterhead. PNG with a transparent background looks best.
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-4">
          <div className="flex h-20 w-32 items-center justify-center rounded-md border border-dashed border-border bg-background/50 p-2">
            {value.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.logo} alt="Company logo" className="max-h-16 max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted">No logo yet</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => void onLogoFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:border-brand"
            >
              {value.logo ? "Replace logo" : "Upload logo"}
            </button>
            {value.logo ? (
              <button type="button" onClick={() => set({ logo: null })} className="text-xs text-muted hover:text-brand-soft">
                Remove
              </button>
            ) : null}
            {logoError ? <p className="text-xs text-brand-soft">{logoError}</p> : null}
          </div>
        </div>
      </div>

      {/* Colour + theme */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-color`} className={LABEL}>
            Brand colour
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id={`${id}-color`}
              type="color"
              value={isHexColor(hexText) ? hexText : value.primary}
              onChange={(e) => {
                setHexText(e.target.value);
                set({ primary: e.target.value.toLowerCase() });
              }}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
              aria-label="Pick the brand colour"
            />
            <input
              value={hexText}
              onChange={(e) => {
                const v = e.target.value.trim();
                setHexText(v);
                if (isHexColor(v)) set({ primary: v.toLowerCase() });
              }}
              placeholder="#a01c2d"
              spellCheck={false}
              className={`${FIELD} font-mono sm:w-32`}
              aria-label="Brand colour as hex"
            />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-4 w-8 rounded" style={{ background: dark.accent }} aria-hidden /> on dark
            </span>
            <span className="flex items-center gap-1">
              <span className="h-4 w-8 rounded border border-border" style={{ background: light.accent }} aria-hidden /> on light
            </span>
            {!compact ? <span>— adjusted so buttons stay readable</span> : null}
          </div>
        </div>
        <div>
          <span className={LABEL}>Default theme</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(["dark", "light", "system"] as BrandTheme[]).map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                  value.theme === t ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted hover:text-foreground"
                }`}
              >
                <input type="radio" name={`${id}-theme`} value={t} checked={value.theme === t} onChange={() => set({ theme: t })} className="sr-only" />
                {t === "system" ? "Follow the device" : t === "dark" ? "Dark" : "Light"}
              </label>
            ))}
          </div>
          {!compact ? <p className="mt-1 text-xs text-muted/70">What a new sign-in sees. Anyone can still switch on their own device.</p> : null}
        </div>
      </div>

      {/* Words */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Slogan</span>
          <input value={value.slogan} onChange={(e) => set({ slogan: e.target.value })} placeholder="Built right, on time." maxLength={120} spellCheck className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Tagline (one sentence)</span>
          <input value={value.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Design-build for homes and small multifamily across Los Angeles." maxLength={200} spellCheck className={FIELD} />
        </label>
      </div>

      {/* Voice + job types */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className={LABEL}>How your proposals should sound</span>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {(Object.keys(VOICE_LABELS) as BrandVoice[]).map((v) => (
              <label key={v} className="flex items-start gap-2 text-sm">
                <input type="radio" name={`${id}-voice`} checked={value.voice === v} onChange={() => set({ voice: v })} className="mt-1 accent-brand" />
                <span>
                  <span className="text-foreground">{VOICE_LABELS[v]}</span>
                  {!compact ? <span className="block text-xs text-muted">{VOICE_GUIDE[v]}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <span className={LABEL}>The kinds of jobs you take</span>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {Object.entries(JOB_TYPE_LABELS).map(([k, label]) => {
              const on = value.job_types.includes(k);
              return (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => set({ job_types: on ? value.job_types.filter((t) => t !== k) : [...value.job_types, k] })}
                    className="accent-brand"
                  />
                  <span className={on ? "text-foreground" : "text-muted"}>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
