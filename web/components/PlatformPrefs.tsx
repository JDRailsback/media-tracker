"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  KNOWN_PLATFORMS,
  getPreferredPlatforms,
  togglePreferredPlatform,
  getShowOnlyPreferred,
  setShowOnlyPreferred,
  type PlatformKind,
} from "@/lib/platformPrefs";

export default function PlatformPrefs() {
  // Keyed by kind — each group (Streaming, Rent & Buy, Game stores, Music)
  // reads/writes its OWN preference list now, not one shared list (see
  // lib/platformPrefs.ts's comment on why streaming and rent/buy picks for
  // the same real-world service, e.g. Prime Video, are tracked separately).
  const [preferred, setPreferred] = useState<Record<PlatformKind, string[]>>({
    stream: [],
    rentBuy: [],
    store: [],
    music: [],
  });
  const [showOnly, setShowOnly] = useState(false);

  useEffect(() => {
    setPreferred({
      stream: getPreferredPlatforms("stream"),
      rentBuy: getPreferredPlatforms("rentBuy"),
      store: getPreferredPlatforms("store"),
      music: getPreferredPlatforms("music"),
    });
    setShowOnly(getShowOnlyPreferred());
  }, []);

  function toggle(name: string, kind: PlatformKind) {
    togglePreferredPlatform(name, kind);
    setPreferred((prev) => ({ ...prev, [kind]: getPreferredPlatforms(kind) }));
  }

  return (
    <div className="space-y-5">
      <label className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-3.5 py-3">
        <span className="text-[13.5px] text-ink">
          Only show preferred platforms
          <span className="mt-0.5 block text-[12px] text-subtle">
            Hide everything else under &ldquo;Available on&rdquo; instead of just pinning these first.
          </span>
        </span>
        <button
          role="switch"
          aria-checked={showOnly}
          onClick={() => {
            const next = !showOnly;
            setShowOnlyPreferred(next);
            setShowOnly(next);
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
            showOnly ? "bg-accent" : "bg-hairline"
          }`}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: showOnly ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </label>

      {KNOWN_PLATFORMS.map(({ group, kind, names }) => (
        <div key={group}>
          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
            {group}
          </h3>
          <div className="flex flex-wrap gap-2">
            {names.map((name) => {
              const active = preferred[kind].includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggle(name, kind)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                    active
                      ? "bg-accent text-on-accent"
                      : "bg-canvas text-ink hover:bg-hairline/60"
                  }`}
                >
                  {active && <Check size={13} />}
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
