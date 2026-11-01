// Light or dark screen theme. The choice is a per-browser convenience, so it lives in localStorage.
// Storage can be blocked (private windows), so every access is guarded and the app still works without it.

export type Theme = "light" | "dark";

const KEY = "jb-theme";

export function savedTheme(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** The saved choice, or the device setting when nothing has been chosen yet. */
export function currentTheme(): Theme {
  return savedTheme() ?? systemTheme();
}

/** Puts the theme on the page. `color-scheme` makes form controls and scrollbars match. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function setTheme(theme: Theme) {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Not saved: the choice still applies to this page view.
  }
  applyTheme(theme);
}
