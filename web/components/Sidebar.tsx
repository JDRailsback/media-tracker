"use client";

import { Home, Search, Bookmark, Settings, Film } from "lucide-react";

export type View = "feed" | "discover" | "following" | "settings";

const ITEMS: { id: View; label: string; icon: typeof Home }[] = [
  { id: "feed", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Search },
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
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-hairline bg-white px-4 py-6 md:flex">
      <div className="flex items-center gap-2 px-2 pb-8">
        <Film size={22} className="text-accent" strokeWidth={2.2} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">Media Tracker</span>
      </div>

      <nav className="flex flex-col gap-1">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                isActive
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-ink/70 hover:bg-surface"
              }`}
            >
              <Icon size={18} strokeWidth={isActive ? 2.3 : 1.9} />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
