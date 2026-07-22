"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { INTL_BAR_LEVELS, getIntlBarLevel, setIntlBarLevel, type IntlBarLevel } from "@/lib/intlBar";

// Settings' "Popular upcoming" international bar — mirrors ContentFilters.tsx's
// pattern. onChange fires with the fresh level so the parent (Home) can
// refetch Discover with the new ?intlBar= filter without a full page reload.
export default function IntlBarSetting({ onChange }: { onChange?: (level: IntlBarLevel) => void }) {
  const [level, setLevel] = useState<IntlBarLevel>("moderate");

  useEffect(() => setLevel(getIntlBarLevel()), []);

  function choose(next: IntlBarLevel) {
    setIntlBarLevel(next);
    setLevel(next);
    onChange?.(next);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {INTL_BAR_LEVELS.map(({ key, label, description }) => {
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
