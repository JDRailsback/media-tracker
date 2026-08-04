"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Home, Compass, Bookmark, CalendarDays, ListChecks, Bell, Settings, User, LogOut } from "lucide-react";

export type View = "feed" | "discover" | "following" | "calendar" | "dugout" | "notifications" | "settings";

// Exported so MobileNav can use the exact same list instead of maintaining
// its own copy — the two used to be hand-kept in sync by convention only
// (same items/order/icons duplicated in both files), which is exactly the
// kind of thing that silently drifts the moment one gets edited alone.
export const NAV_ITEMS: { id: View; label: string; icon: typeof Home }[] = [
  { id: "feed", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "following", label: "Following", icon: Bookmark },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "dugout", label: "Dugout", icon: ListChecks },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

// Nocturne sidebar: no glass panel, no gradient logo chip — a tracked
// uppercase wordmark with the final letter in accent, and a 2px left bar as
// the only active-state decoration. The chrome recedes; the feed is the show.
export default function Sidebar({
  active,
  onChange,
  unreadCount = 0,
}: {
  active: View;
  onChange: (v: View) => void;
  // Unread notification-history entries — shown as a small count pill on
  // the Notifications item; hidden at zero.
  unreadCount?: number;
}) {
  const { data: session, status } = useSession();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-hairline/70 px-4 py-5 md:flex">
      <div className="px-3 pb-5 text-[42px] font-extrabold uppercase tracking-[0.14em] text-ink">
        Track<span className="text-accent">r</span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
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
              {id === "notifications" && unreadCount > 0 && (
                <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-on-accent">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Pinned to the bottom, visible on every view — signing in
          shouldn't be something you have to go dig for in Settings. Bigger
          than the nav icons/labels above (this is an anchor, not another
          tab) and doesn't navigate anywhere on click — sign-out lives
          right here instead. Changing the username itself is in Settings. */}
      {status !== "loading" && (
        <div className="mt-auto border-t border-hairline/70 px-3 pt-4">
          {session ? (
            <div className="flex items-center gap-3 py-1">
              <User size={20} strokeWidth={1.9} className="shrink-0 text-subtle" />
              <span className="flex-1 truncate text-[15px] text-ink">{session.user?.username}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                aria-label="Sign out"
                className="shrink-0 text-subtle transition-colors hover:text-ink"
              >
                <LogOut size={17} strokeWidth={1.9} />
              </button>
            </div>
          ) : (
            <Link href="/signin" className="flex items-center gap-3 py-1 text-[15px] text-subtle hover:text-ink">
              <User size={20} strokeWidth={1.9} />
              Sign in
            </Link>
          )}
        </div>
      )}
    </aside>
  );
}
