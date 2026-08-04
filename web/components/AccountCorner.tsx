"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { User } from "lucide-react";

// Mobile's persistent, always-visible account indicator. MobileNav's bottom
// tab bar is already full at 7 items (see its own comment), so this lives
// as its own small fixed corner element instead — signed out shows a
// prominent "Sign in" pill; signed in shows an avatar-initial button that
// opens Settings (where the actual sign-out control lives) rather than
// signing out on a single stray tap.
export default function AccountCorner({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { data: session, status } = useSession();

  if (status === "loading") return null;

  if (!session) {
    return (
      <Link
        href="/signin"
        className="fixed right-4 top-4 z-20 flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent shadow-lg md:hidden"
      >
        <User size={14} />
        Sign in
      </Link>
    );
  }

  return (
    <button
      onClick={onOpenAccount}
      aria-label="Account"
      className="fixed right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-surface text-[13px] font-semibold text-ink ring-1 ring-hairline shadow-lg md:hidden"
    >
      {(session.user?.username?.[0] ?? "?").toUpperCase()}
    </button>
  );
}
