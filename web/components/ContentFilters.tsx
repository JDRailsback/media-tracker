"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CONTENT_CATEGORIES, type ContentCategory } from "@/lib/contentFilters";
import { getHiddenCategories, toggleHiddenCategory } from "@/lib/hiddenCategories";

// Settings' "Content filters" section — mirrors PlatformPrefs.tsx's pattern.
// onChange fires with the fresh selection so the parent (Home) can refetch
// Discover/Search with the new ?hide= filter without a full page reload.
export default function ContentFilters({ onChange }: { onChange?: (hidden: ContentCategory[]) => void }) {
  const [hidden, setHidden] = useState<ContentCategory[]>([]);

  useEffect(() => setHidden(getHiddenCategories()), []);

  function toggle(key: ContentCategory) {
    toggleHiddenCategory(key);
    const next = getHiddenCategories();
    setHidden(next);
    onChange?.(next);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CONTENT_CATEGORIES.map(({ key, label, description }) => {
        const active = hidden.includes(key);
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
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
