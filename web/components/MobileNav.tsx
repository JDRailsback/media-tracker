"use client";

import { Home, Compass, Bookmark, CalendarDays, ListChecks, Bell, Settings } from "lucide-react";
import type { View } from "./Sidebar";

const ITEMS: { id: View; label: string; icon: typeof Home }[] = [
  { id: "feed", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "following", label: "Following", icon: Bookmark },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "dugout", label: "Dugout", icon: ListChecks },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

// Sidebar's mobile counterpart — Sidebar is `hidden md:flex` (see its own
// comment), so below that breakpoint there was previously no navigation at
// all. Fixed bottom bar, same items/order/active-state source as Sidebar, so
// the two are always in sync with zero extra state. pb-[env(...)] clears the
// home-indicator on notched phones (viewport has viewportFit: "cover" — see
// app/layout.tsx — so safe-area-inset-bottom is meaningful here). Sized down
// a step (18px icons, 9.5px labels, tighter padding) from an earlier 6-item
// version to fit 7 tabs at a 375px phone width without wrapping.
export default function MobileNav({
  active,
  onChange,
  unreadCount = 0,
}: {
  active: View;
  onChange: (v: View) => void;
  unreadCount?: number;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-hairline/70 bg-panel/95 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden">
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`relative flex flex-1 flex-col items-center gap-0.5 px-0.5 py-1.5 text-[9.5px] transition-colors duration-200 ${
              isActive ? "font-semibold text-ink" : "text-subtle"
            }`}
          >
            <span className="relative">
              <Icon size={18} strokeWidth={isActive ? 2.3 : 1.9} />
              {id === "notifications" && unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-accent px-0.5 text-[8.5px] font-bold leading-none text-on-accent">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
