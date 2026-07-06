"use client";

import { useEffect, useState } from "react";
import { X, Play, Plus, Check } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { describeRelease } from "@/lib/feed";
import TypeTag from "./TypeTag";

export default function DetailModal({
  item,
  isFollowed,
  onFollow,
  onUnfollow,
  onClose,
}: {
  item: MediaItem;
  isFollowed: boolean;
  onFollow: (full: MediaItem) => void;
  onUnfollow: () => void;
  onClose: () => void;
}) {
  const [full, setFull] = useState<MediaItem>(item);

  useEffect(() => {
    const idx = item.id.indexOf(":");
    if (idx < 0) return;
    const type = item.id.slice(0, idx);
    const id = item.id.slice(idx + 1);
    fetch(`/api/item/${type}/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setFull(d))
      .catch(() => {});
  }, [item.id]);

  const release = describeRelease({ ...full, followedAt: "" });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-30 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85vh] w-full max-w-2xl animate-scale-in overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-hairline"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full bg-canvas/90 p-1.5 text-ink/70 backdrop-blur transition-colors hover:text-ink"
        >
          <X size={16} strokeWidth={2.5} />
        </button>

        <div className="hidden w-56 shrink-0 bg-canvas sm:block">
          {full.posterURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={full.posterURL} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <TypeTag type={full.type} />
          <h1 className="mt-2.5 text-2xl font-bold text-ink">{full.title}</h1>
          <div className="mt-1.5 flex items-center gap-2 text-[13px] text-subtle">
            {full.subtitle && <span>{full.subtitle}</span>}
            {release && (
              <>
                {full.subtitle && <span>·</span>}
                <span className="font-semibold text-accent">{release.label}</span>
              </>
            )}
          </div>

          <button
            onClick={() => (isFollowed ? onUnfollow() : onFollow(full))}
            className={`mt-4 flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold transition-all duration-200 active:scale-95 ${
              isFollowed
                ? "bg-canvas text-ink hover:bg-hairline/60"
                : "bg-gradient-to-r from-accent to-accent-2 text-on-accent shadow-md shadow-accent/25 hover:brightness-110"
            }`}
          >
            {isFollowed ? <Check size={15} /> : <Plus size={15} />}
            {isFollowed ? "Following" : "Follow"}
          </button>

          {full.overview && (
            <p className="mt-5 text-[14px] leading-relaxed text-ink/80">{full.overview}</p>
          )}

          {full.externalLinks && full.externalLinks.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
                Available on
              </h2>
              <div className="flex flex-wrap gap-2">
                {full.externalLinks.map((l) => (
                  <a
                    key={`${l.provider}-${l.kind}-${l.url}`}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5 text-[13px] font-medium text-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-hairline/60"
                  >
                    <Play size={12} className="fill-ink text-ink" />
                    {l.provider}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
