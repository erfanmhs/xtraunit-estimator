/**
 * Theme constants shared by the server layout and the client toggle.
 *
 * This file has no "use client" on purpose. The root layout is a server
 * component, and importing a plain constant out of a client module would give
 * it a client reference rather than the string — the init script would render
 * empty and every light-mode user would get a dark flash on load.
 */

export type Theme = "dark" | "light";

export const THEME_KEY = "xu-theme";

/** Status-bar / browser-chrome colour, matching --background in each theme. */
export const THEME_COLOR: Record<Theme, string> = {
  dark: "#0b0e14",
  light: "#f7f8fa",
};

/**
 * Runs before the page paints so a light-mode user never sees a dark flash.
 * Dark is the fallback for a first visit, a cleared browser, or blocked
 * storage — the app's default does not follow the operating system.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;
