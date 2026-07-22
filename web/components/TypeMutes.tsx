"use client";

import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import type { MediaType } from "@/lib/types";
import { MUTABLE_TYPES } from "@/lib/notificationPrefs";
import { fetchPrefs } from "@/lib/push-client";

// Settings' "Muted alert types" section — mirrors ContentFilters.tsx's pill
// pattern, but the selection lives SERVER-side on this device's push
// subscription (see /api/prefs) rather than in localStorage: the daily poll
// is what enforces it, so localStorage alone couldn't. Muted types never
// push; their events still land in notification history.
//
// Remount this (key it on push-enabled state) after enabling push so the
// disabled hint gives way to the real controls.
export default function TypeMutes() {
  // undefined = still loading; null = no push subscription on this device.
  const [muted, setMuted] = useState<MediaType[] | null | undefined>(undefined);

  useEffect(() => {
    fetchPrefs().then((p) => setMuted(p ? p.mutedTypes : null));
  }, []);

  if (muted === undefined) return <p className="text-[13px] text-subtle">Loading…</p>;
  if (muted === null) {
    return (
      <p className="text-[13px] text-subtle">
        Enable notifications above to customize which types alert you.
      </p>
    );
  }

  function toggle(type: MediaType) {
    if (!muted) return;
    const next = muted.includes(type) ? muted.filter((t) => t !== type) : [...muted, type];
    setMuted(next); // optimistic — a failed save just resyncs on next mount
    void fetchPrefs({ mutedTypes: next });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {MUTABLE_TYPES.map(({ type, label }) => {
        const active = muted.includes(type);
        return (
          <button
            key={type}
            onClick={() => toggle(type)}
            title={active ? `Unmute ${label} alerts` : `Mute ${label} alerts`}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
              active ? "bg-accent text-on-accent" : "bg-canvas text-ink hover:bg-hairline/60"
            }`}
          >
            {active && <BellOff size={13} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
