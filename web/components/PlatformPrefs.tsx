"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { KNOWN_PLATFORMS, getPreferredPlatforms, togglePreferredPlatform } from "@/lib/platformPrefs";

export default function PlatformPrefs() {
  const [preferred, setPreferred] = useState<string[]>([]);

  useEffect(() => setPreferred(getPreferredPlatforms()), []);

  function toggle(name: string) {
    togglePreferredPlatform(name);
    setPreferred(getPreferredPlatforms());
  }

  return (
    <div className="space-y-5">
      {KNOWN_PLATFORMS.map(({ group, names }) => (
        <div key={group}>
          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
            {group}
          </h3>
          <div className="flex flex-wrap gap-2">
            {names.map((name) => {
              const active = preferred.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggle(name)}
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
