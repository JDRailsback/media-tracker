export type Theme = "light" | "dark";

const KEY = "theme";

export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
}

// Inline, blocking script (run before hydration) so there's no flash of the
// wrong theme. Defaults to dark per product decision.
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('${KEY}');
    var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
