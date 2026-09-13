import { describe, expect, it } from "vitest";
import {
  accentSet,
  brandCss,
  contrast,
  DEFAULT_PRIMARY,
  isHexColor,
  isLogoDataUrl,
  resolveBranding,
} from "./branding";

describe("resolveBranding — reads any stored block safely", () => {
  it("fills defaults and drops bad values", () => {
    const b = resolveBranding({ primary: "red", theme: "neon", voice: "loud", logo: "javascript:alert(1)", slogan: "  Built right  " });
    expect(b.primary).toBe(DEFAULT_PRIMARY);
    expect(b.theme).toBe("dark");
    expect(b.voice).toBe("plain");
    expect(b.logo).toBeNull();
    expect(b.slogan).toBe("Built right");
    expect(b.onboarded_at).toBeNull();
  });
  it("keeps good values", () => {
    const b = resolveBranding({ primary: "#1F5AA6", theme: "light", voice: "warm", job_types: ["residential", "adu_addition"], onboarded_at: "2026-09-12T00:00:00Z" });
    expect(b.primary).toBe("#1f5aa6");
    expect(b.theme).toBe("light");
    expect(b.voice).toBe("warm");
    expect(b.job_types).toEqual(["residential", "adu_addition"]);
    expect(b.onboarded_at).toBe("2026-09-12T00:00:00Z");
  });
  it("accepts only small raster data URLs as a logo", () => {
    expect(isLogoDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isLogoDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isLogoDataUrl("https://x.com/logo.png")).toBe(false);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("#AABBCC")).toBe(true);
  });
});

describe("accentSet — one brand colour, readable in both themes", () => {
  it("lifts a dark brand colour on the dark theme until it reads as an action", () => {
    const d = accentSet("#1a2a5a", "dark"); // a navy that would vanish on near-black
    expect(contrast(d.accent, "#0b0e14")).toBeGreaterThanOrEqual(4.5);
    expect(d.on).toBe("#ffffff");
  });
  it("deepens a pale brand colour on the light theme", () => {
    const l = accentSet("#f5c542", "light"); // a yellow that would vanish on white
    expect(contrast(l.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
  it("leaves the default red essentially alone and emits CSS for both themes", () => {
    const css = brandCss(DEFAULT_PRIMARY);
    expect(css).toContain(':root[data-theme="dark"]{--accent:');
    expect(css).toContain(':root[data-theme="light"]{--accent:');
    expect(css).not.toContain("undefined");
  });
});
