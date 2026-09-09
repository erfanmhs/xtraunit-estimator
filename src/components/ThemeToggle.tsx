"use client";

/**
 * Light / dark switch.
 *
 * Dark is the default and stays the default whatever the operating system is
 * set to — nobody's app changes under them because they turned on night mode
 * in iOS. Light is a deliberate choice, remembered per device.
 *
 * The choice lives in one place, `data-theme` on <html>, which is what every
 * colour token in globals.css keys off. Nothing else in the app needs to know
 * a theme exists.
 *
 * The value is read back before first paint by the inline script in
 * layout.tsx. The storage key, the default and the script all live in
 * `@/lib/theme` so the server layout and this component can never disagree.
 */
import { useSyncExternalStore } from "react";
import { THEME_COLOR, THEME_KEY, type Theme } from "@/lib/theme";

/**
 * The theme lives in the DOM (`data-theme` on <html>), not in React — the
 * init script sets it before React exists. So it is read as an external
 * store rather than mirrored into state, which also keeps every toggle on the
 * page in sync if we ever add a second one.
 */
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => obs.disconnect();
}
const getSnapshot = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";
const getServerSnapshot = (): Theme => "dark";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private browsing, or site data blocked. The theme still applies for
    // this page; it just won't be remembered.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const options: { id: Theme; label: string; icon: React.ReactElement }[] = [
    {
      id: "dark",
      label: "Dark",
      icon: (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ),
    },
    {
      id: "light",
      label: "Light",
      icon: (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ),
    },
  ];

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="inline-flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
    >
      {options.map((o) => {
        const on = theme === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => applyTheme(o.id)}
            aria-pressed={on}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              on
                ? "bg-brand text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
