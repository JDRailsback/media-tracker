"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { replaceFollowed } from "@/lib/library";

// Guard for every account-gated action (follow, Dugout, push notifications,
// calendar sync) — these all write to a real users.id now that anonymous
// follows/dugout rows were removed entirely (see lib/dugout.ts and the
// follow/unfollow/dugout/mute/prefs/subscribe API routes, all of which
// 401 without a session). Call the returned function immediately before
// the action; it redirects to /signin and returns false when signed out,
// or returns true so the caller can proceed.
export function useRequireAuth(): () => boolean {
  const { data: session } = useSession();
  const router = useRouter();
  return () => {
    if (!session) {
      router.push("/signin");
      return false;
    }
    return true;
  };
}

// Global companion to useRequireAuth — mounted once in AuthProvider so it
// runs on every route, not just Home. lib/library.ts's `followed` cache is
// read DIRECTLY off localStorage by several routes (the artist page,
// /calendar, /collection/[slug] all call isFollowed()/getFollowed() at
// render time, not through app/page.tsx's own state) — gating the write
// actions alone left the account's entire follow list still READABLE to a
// signed-out viewer on any browser that had ever been signed in, since
// nothing ever cleared what sign-in had synced down. Verified live: Home
// kept showing a full, real feed to a signed-out viewer until this existed.
export function useClearFollowedOnSignOut(): void {
  const { status } = useSession();
  useEffect(() => {
    if (status !== "unauthenticated") return;
    replaceFollowed([]);
  }, [status]);
}
