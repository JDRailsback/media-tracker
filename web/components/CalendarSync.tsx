"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";

// Settings → "Calendar sync": the URL to subscribe to in Google Calendar /
// Apple Calendar / Outlook ("Add calendar from URL"). Account-only — the
// feed route (app/api/calendar/feed.ics) always requires a per-account
// ?token= now (anonymous follows were removed entirely, so there's no
// unscoped global list left to expose unauthenticated). session.user.
// calendarToken carries it here (set in auth.ts's jwt/session callbacks)
// so the URL only ever exposes this account's own follows.
export default function CalendarSync() {
  const { data: session } = useSession();
  // Built client-side from the current origin so this works whether the
  // app is on localhost during dev or a real deployed domain — there's no
  // server-known "canonical" host to hardcode.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!session) {
    return (
      <p className="text-[13px] text-subtle">
        <Link href="/signin" className="font-medium text-accent hover:underline">
          Sign in
        </Link>{" "}
        to get your own calendar sync link.
      </p>
    );
  }

  const feedUrl = origin ? `${origin}/api/calendar/feed.ics?token=${session.user.calendarToken}` : "";
  // webcal:// is the one widely-recognized scheme for "open my OS/browser's
  // default calendar app's subscribe flow" — Apple Calendar and many
  // Google Calendar setups register it; the plain https URL above still
  // works everywhere via each app's own "Add calendar from URL" import,
  // so this is a convenience shortcut, not the only path.
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://");

  async function copy() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the URL is still
      // selectable in the input below, so this isn't a dead end.
    }
  }

  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
      <input
        readOnly
        value={feedUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="input flex-1 text-[13px] text-subtle"
      />
      <div className="flex shrink-0 gap-2">
        <button
          onClick={copy}
          disabled={!feedUrl}
          className="flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink ring-1 ring-hairline transition-colors hover:bg-panel disabled:opacity-50"
        >
          {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={webcalUrl || undefined}
          className={`flex items-center rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-opacity hover:opacity-90 ${
            feedUrl ? "" : "pointer-events-none opacity-50"
          }`}
        >
          Subscribe
        </a>
      </div>
    </div>
  );
}
