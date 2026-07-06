"use client";

import { Home, Search, Compass, Bookmark, Settings, Clapperboard } from "lucide-react";

export type View = "feed" | "discover" | "search" | "following" | "settings";

const ITEMS: { id: View; label: string; icon: typeof Home }[] = [
  { id: "feed", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "search", label: "Search", icon: Search },
  { id: "following", label: "Following", icon: Bookmark },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function Sidebar({
  active,
  onChange,
}: {
  active: View;
  onChange: (v: View) => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-hairline bg-panel/70 px-4 py-7 backdrop-blur-xl md:flex">
      <div className="flex items-center gap-2.5 px-2 pb-9">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 shadow-lg shadow-accent/30">
          <Clapperboard size={17} className="text-on-accent" strokeWidth={2.2} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-ink">Media Tracker</span>
      </div>

      <nav className="flex flex-col gap-1">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-r from-accent/15 to-accent-2/10 font-semibold text-accent"
                  : "text-subtle hover:bg-surface hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={isActive ? 2.3 : 1.9} className="transition-transform duration-200" />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
