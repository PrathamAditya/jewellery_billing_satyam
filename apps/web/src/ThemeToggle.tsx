import { useState } from "react";
import { currentTheme, setTheme, type Theme } from "./theme";

/** A header button that switches between light and dark screens. */
export default function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(currentTheme);
  const dark = theme === "dark";
  const next: Theme = dark ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        setLocal(next);
      }}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="shrink-0 px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-sm"
    >
      <span aria-hidden>{dark ? "☀" : "☾"}</span>
      <span className="max-sm:hidden ml-1.5">{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
