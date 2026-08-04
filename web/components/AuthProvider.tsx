"use client";

import { SessionProvider } from "next-auth/react";

// Thin client wrapper so RootLayout (a server component) can still render
// a session context — useSession()/signIn()/signOut() elsewhere in the app
// (Settings' Account block, CalendarSync, app/signin) all need this above
// them in the tree.
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
