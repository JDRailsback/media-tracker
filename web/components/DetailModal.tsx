"use client";

import { useEffect, useState } from "react";
import { X, Play, Plus, Check, Star } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { describeRelease, formatTime } from "@/lib/feed";
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
      // Keep a backdrop the shelf item already carried if the fresh fetch
      // lacks one — the tables refresh on different schedules (trending vs
      // catalog), so "no backdrop in this response" doesn't mean none exists.
      .then((d: MediaItem | null) => d && setFull((prev) => ({ ...d, backdropURL: d.backdropURL ?? prev.backdropURL })))
      .catch(() => {});
  }, [item.id]);

  const release = describeRelease({ ...full, followedAt: "" });

  // Hero art preference: true wide backdrop when the pipeline has one,
  // else the poster (crops to landscape under the scrim), else no art.
  const heroArt = full.backdropURL ?? full.posterURL;

  // The "next episode" the server already picked (see catalogRowToMediaItem
  // in lib/catalog.ts) is encoded in subtitle as "S{season} E{episode}" —
  // reparsed here rather than duplicating that selection logic, so the
  // episode list highlight always agrees with the header's release label.
  const nextEpMatch = full.type === "tvShow" ? /^S(\d+) E(\d+)$/.exec(full.subtitle ?? "") : null;
  const nextEp = nextEpMatch ? { season: Number(nextEpMatch[1]), episode: Number(nextEpMatch[2]) } : null;

  const episodes = full.episodes
    ? [...full.episodes].sort((a, b) => {
        // Specials (season 0) sorted after every real season, not first —
        // otherwise a show's special episodes bury the actual season 1
        // opener at the top of the list.
        if (a.season === 0 && b.season !== 0) return 1;
        if (b.season === 0 && a.season !== 0) return -1;
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
      })
    : undefined;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-30 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-hairline"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full bg-black/45 p-1.5 text-white/85 backdrop-blur transition-colors hover:text-white"
        >
          <X size={16} strokeWidth={2.5} />
        </button>

        <div className="scrollbar-none flex-1 overflow-y-auto">
          {/* Marquee hero — the artwork IS the header: full-bleed backdrop
              (wide art ingested per source; see MediaItem.backdropURL) with
              the title set on it over a scrim that melts into the panel.
              Falls back to the poster (cropped landscape, still works under
              the scrim) and then to a bare short header when there's no art
              at all. Title text is a fixed near-white when art is behind it
              — the scrim guarantees a dark ground in both themes, so
              theme-reactive ink would actually be wrong here. */}
          <div className={`relative ${heroArt ? "h-44 sm:h-52" : "h-24"}`}>
            {heroArt && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroArt} alt="" className="h-full w-full object-cover" />
            )}
            <div
              className="absolute inset-0"
              style={{
                background: heroArt
                  ? "linear-gradient(to bottom, rgb(2 6 16 / 0.12) 0%, rgb(2 6 16 / 0.45) 55%, rgb(var(--color-surface)) 98%)"
                  : undefined,
              }}
            />
            <div className="absolute inset-x-6 bottom-3 pr-6">
              <TypeTag type={full.type} />
              <h1
                className={`mt-1.5 text-xl font-bold leading-tight sm:text-2xl ${
                  heroArt ? "text-[#F2F5FB]" : "text-ink"
                }`}
              >
                {full.title}
              </h1>
            </div>
          </div>

          <div className="p-6 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-subtle">
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
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold transition-all duration-200 active:scale-95 ${
                  isFollowed
                    ? "bg-canvas text-ink hover:bg-hairline/60"
                    : "bg-accent text-on-accent hover:brightness-110"
                }`}
              >
                {isFollowed ? <Check size={15} /> : <Plus size={15} />}
                {isFollowed ? "Following" : "Follow"}
              </button>
            </div>

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

          {full.overview && (
            <p className="mt-5 text-[14px] leading-relaxed text-ink/80">{full.overview}</p>
          )}

          {episodes && episodes.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
                {full.episodeCount ?? episodes.length} episode
                {(full.episodeCount ?? episodes.length) === 1 ? "" : "s"}
                {" · "}
                {new Set(episodes.map((e) => e.season)).size} season
                {new Set(episodes.map((e) => e.season)).size === 1 ? "" : "s"}
              </h2>
              <div className="scrollbar-none max-h-64 space-y-1 overflow-y-auto rounded-xl bg-canvas p-2">
                {episodes.map((ep) => {
                  const isNext = nextEp && ep.season === nextEp.season && ep.episode === nextEp.episode;
                  return (
                    <div
                      key={`${ep.season}-${ep.episode}`}
                      className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] ${
                        isNext ? "bg-accent/12" : "hover:bg-hairline/40"
                      }`}
                    >
                      <span className="min-w-0 truncate text-ink">
                        <span className={`font-medium ${isNext ? "text-accent" : "text-subtle"}`}>
                          S{ep.season}E{ep.episode}
                        </span>{" "}
                        {ep.title}
                      </span>
                      {ep.airDate && (
                        <span className={`shrink-0 ${isNext ? "font-semibold text-accent" : "text-subtle"}`}>
                          {new Date(ep.airDate).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                          {/* airStamp is a real UTC instant, so its own Date
                              conversion (not ep.airDate's day-precision one)
                              is what's actually correct for the local time. */}
                          {ep.airStamp && `, ${formatTime(new Date(ep.airStamp))}`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          </div>
        </div>
      </div>
    </div>
  );
}
