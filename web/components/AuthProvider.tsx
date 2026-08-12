"use client";

import { SessionProvider } from "next-auth/react";
import { useClearFollowedOnSignOut } from "@/lib/requireAuth";

// useClearFollowedOnSignOut needs useSession(), which only works BELOW
// SessionProvider in the tree — this small wrapper is that "below."
function FollowedCacheGuard({ children }: { children: React.ReactNode }) {
  useClearFollowedOnSignOut();
  return <>{children}</>;
}

// Thin client wrapper so RootLayout (a server component) can still render
// a session context — useSession()/signIn()/signOut() elsewhere in the app
// (Settings' Account block, CalendarSync, app/signin) all need this above
// them in the tree. Also hosts FollowedCacheGuard so the localStorage
// follow cache gets cleared on EVERY route when signed out, not just Home.
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <FollowedCacheGuard>{children}</FollowedCacheGuard>
    </SessionProvider>
  );
}
