"use client";

import { Home, Compass, Bookmark, Settings } from "lucide-react";

export type View = "feed" | "discover" | "following" | "settings";

const ITEMS: { id: View; label: string; icon: typeof Home }[] = [
  { id: "feed", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "following", label: "Following", icon: Bookmark },
  { id: "settings", label: "Settings", icon: Settings },
];

// Nocturne sidebar: no glass panel, no gradient logo chip — a tracked
// uppercase wordmark with the final letter in accent, and a 2px left bar as
// the only active-state decoration. The chrome recedes; the feed is the show.
export default function Sidebar({
  active,
  onChange,
}: {
  active: View;
  onChange: (v: View) => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-hairline/70 px-4 py-5 md:flex">
      <div className="px-3 pb-5 text-[42px] font-extrabold uppercase tracking-[0.14em] text-ink">
        Track<span className="text-accent">r</span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`flex items-center gap-3 border-l-2 px-3 py-2.5 text-[14px] transition-colors duration-200 ${
                isActive
                  ? "border-accent font-semibold text-ink"
                  : "border-transparent text-subtle hover:text-ink"
              }`}
            >
              <Icon size={17} strokeWidth={isActive ? 2.3 : 1.9} />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
