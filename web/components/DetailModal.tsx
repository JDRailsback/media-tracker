"use client";

import { useEffect, useState } from "react";
import { X, Play, Plus, Check, Star } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { describeRelease } from "@/lib/feed";
import { getPreferredPlatforms, isPreferredProvider } from "@/lib/platformPrefs";
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
  const [preferred, setPreferred] = useState<string[]>([]);

  useEffect(() => setPreferred(getPreferredPlatforms()), []);

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

        {/* Fills the full height of the modal (bounded by max-h-[85vh] on
            the outer container below, so it's never unreasonably tall) —
            object-cover crops to fit without ever distorting the image.
            Tried a fixed aspect-[2/3] + self-start here instead, but that
            traded "crop varies with content length" for "empty dead space
            below a small, fixed-size poster whenever the content column
            (episode list, long overview) is taller" — worse in practice. */}
        <div className="hidden w-56 shrink-0 bg-canvas sm:block">
          {full.posterURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={full.posterURL} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="scrollbar-none flex-1 overflow-y-auto p-6">
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

          {full.episodes && full.episodes.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
                {full.episodeCount ?? full.episodes.length} episode
                {(full.episodeCount ?? full.episodes.length) === 1 ? "" : "s"}
                {" · "}
                {new Set(full.episodes.map((e) => e.season)).size} season
                {new Set(full.episodes.map((e) => e.season)).size === 1 ? "" : "s"}
              </h2>
              <div className="scrollbar-none max-h-64 space-y-1 overflow-y-auto rounded-xl bg-canvas p-2">
                {full.episodes.map((ep) => (
                  <div
                    key={`${ep.season}-${ep.episode}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-hairline/40"
                  >
                    <span className="min-w-0 truncate text-ink">
                      <span className="font-medium text-subtle">
                        S{ep.season}E{ep.episode}
                      </span>{" "}
                      {ep.title}
                    </span>
                    {ep.airDate && (
                      <span className="shrink-0 text-subtle">
                        {new Date(ep.airDate).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {full.externalLinks && full.externalLinks.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
                Available on
              </h2>
              <div className="flex flex-wrap gap-2">
                {[...full.externalLinks]
                  .sort((a, b) => {
                    const aPref = isPreferredProvider(a.provider, preferred);
                    const bPref = isPreferredProvider(b.provider, preferred);
                    return aPref === bPref ? 0 : aPref ? -1 : 1;
                  })
                  .map((l) => {
                    const isPreferred = isPreferredProvider(l.provider, preferred);
                    return (
                      <a
                        key={`${l.provider}-${l.kind}-${l.url}`}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-200 hover:-translate-y-0.5 ${
                          isPreferred
                            ? "bg-accent/12 text-accent ring-1 ring-accent/40 hover:bg-accent/18"
                            : "bg-canvas text-ink hover:bg-hairline/60"
                        }`}
                      >
                        {isPreferred ? (
                          <Star size={12} className="fill-accent text-accent" />
                        ) : (
                          <Play size={12} className="fill-ink text-ink" />
                        )}
                        {l.provider}
                      </a>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
