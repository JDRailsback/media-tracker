"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { GENERAL_BAR_LEVELS, getGeneralBarLevel, setGeneralBarLevel, type GeneralBarLevel } from "@/lib/generalBar";

// Settings' "Popular upcoming" general bar — mirrors IntlBarSetting.tsx's
// pattern. onChange fires with the fresh level so the parent (Home) can
// refetch Discover with the new ?generalBar= filter without a full page reload.
export default function GeneralBarSetting({ onChange }: { onChange?: (level: GeneralBarLevel) => void }) {
  const [level, setLevel] = useState<GeneralBarLevel>("moderate");

  useEffect(() => setLevel(getGeneralBarLevel()), []);

  function choose(next: GeneralBarLevel) {
    setGeneralBarLevel(next);
    setLevel(next);
    onChange?.(next);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {GENERAL_BAR_LEVELS.map(({ key, label, description }) => {
        const active = level === key;
        return (
          <button
            key={key}
            onClick={() => choose(key)}
            title={description}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
              active ? "bg-accent text-on-accent" : "bg-canvas text-ink hover:bg-hairline/60"
            }`}
          >
            {active && <Check size={13} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
