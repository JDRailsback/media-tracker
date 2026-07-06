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
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-1.5 text-ink/70 shadow-sm hover:bg-white"
        >
          <X size={16} strokeWidth={2.5} />
        </button>

        <div className="hidden w-56 shrink-0 bg-surface sm:block">
          {full.posterURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={full.posterURL} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <TypeTag type={full.type} />
          <h1 className="mt-2 text-2xl font-semibold text-ink">{full.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-subtle">
            {full.subtitle && <span>{full.subtitle}</span>}
            {release && (
              <>
                {full.subtitle && <span>·</span>}
                <span className="font-medium text-accent">{release.label}</span>
              </>
            )}
          </div>

          <button
            onClick={() => (isFollowed ? onUnfollow() : onFollow(full))}
            className={`mt-4 flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${
              isFollowed
                ? "bg-surface text-ink hover:bg-hairline"
                : "bg-accent text-white hover:bg-accent/90"
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
              <h2 className="mb-2 text-[12.5px] font-medium uppercase tracking-wide text-subtle">
                Available on
              </h2>
              <div className="flex flex-wrap gap-2">
                {full.externalLinks.map((l) => (
                  <a
                    key={l.provider + l.url}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-hairline"
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
