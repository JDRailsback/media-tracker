"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { getTheme, setTheme, Theme } from "@/lib/theme";

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => setThemeState(getTheme()), []);

  return (
    <div className="relative flex w-[132px] rounded-full border border-hairline bg-canvas p-1">
      <span
        className="absolute inset-y-1 left-1 w-[60px] rounded-full bg-gradient-to-r from-accent to-accent-2 shadow-sm transition-transform duration-300 ease-out"
        style={{ transform: theme === "dark" ? "translateX(60px)" : "translateX(0)" }}
      />
      {(["light", "dark"] as Theme[]).map((t) => (
        <button
          key={t}
          onClick={() => {
            setTheme(t);
            setThemeState(t);
          }}
          className={`relative z-10 flex w-[60px] items-center justify-center gap-1.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
            theme === t ? "text-on-accent" : "text-subtle hover:text-ink"
          }`}
        >
          {t === "light" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      ))}
    </div>
  );
}
