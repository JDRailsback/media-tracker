"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Plus, Play, Bell, BellOff } from "lucide-react";
import type { MediaItem, ReleaseGroupInfo } from "@/lib/types";
import { addFollow, removeFollow, isFollowed as checkFollowed } from "@/lib/library";
import { fetchPrefs, setItemMuted, syncFollow } from "@/lib/push-client";
import { parseReleaseDay } from "@/lib/feed";
import CollectionRow from "@/components/CollectionRow";

// Dedicated artist profile page — the music counterpart of
// /collection/[slug], replacing the generic DetailModal for artists
// entirely (see handleSelect in app/page.tsx). An artist isn't a single
// titled work: their releases each deserve their own card, so the page is
// a banner + round portrait header over per-kind release rows.

const KIND_SECTIONS: { kind: ReleaseGroupInfo["kind"]; title: string }[] = [
  { kind: "album", title: "Albums" },
  { kind: "ep", title: "EPs" },
  { kind: "single", title: "Singles" },
];

const KIND_LABEL: Record<ReleaseGroupInfo["kind"], string> = { album: "Album", ep: "EP", single: "Single" };

function formatDay(iso: string): string {
  return parseReleaseDay(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ArtistPage({ params }: { params: { id: string } }) {
  const artistID = `artist:${params.id}`;

  const [item, setItem] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [followVersion, setFollowVersion] = useState(0);
  // null = mute control hidden (not followed, or push never enabled on this
  // device — there's no subscription for a mute to act on).
  const [muted, setMuted] = useState<boolean | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/item/artist/${params.id}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => d && setItem(d))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    if (!checkFollowed(artistID)) {
      setMuted(null);
      return;
    }
    fetchPrefs().then((p) => setMuted(p ? p.mutedItemIds.includes(artistID) : null));
  }, [artistID, followVersion]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[14px] text-subtle">
        Unknown artist.
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[14px] text-subtle">
        {loading ? "Loading…" : null}
      </div>
    );
  }

  const followed = checkFollowed(artistID);

  function toggleFollow() {
    if (!item) return;
    if (followed) {
      removeFollow(artistID);
      void syncFollow(artistID, false);
    } else {
      addFollow(item);
      void syncFollow(artistID, true);
    }
    setFollowVersion((v) => v + 1);
  }

  const releases = item.releases ?? [];
  const todayISO = new Date().toISOString().slice(0, 10);
  const next = releases
    .filter((r) => r.date && r.date >= todayISO)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1))[0];
  const heroArt = item.backdropURL ?? item.posterURL;

  return (
    <div className="min-h-screen bg-canvas pb-16">
      {/* ── Banner: the portrait blown up wide, fading into the canvas ── */}
      <div className="relative h-56 w-full overflow-hidden md:h-72">
        {heroArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroArt} alt="" className="h-full w-full object-cover object-[center_25%]" />
        ) : (
          <div className="h-full w-full bg-surface" />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgb(2 6 16 / 0.1) 0%, rgb(2 6 16 / 0.35) 60%, rgb(var(--color-canvas)) 99%)",
          }}
        />
        <Link
          href="/"
          className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-black/45 px-3.5 py-1.5 text-[13px] font-medium text-white/85 backdrop-blur transition-colors hover:text-white"
        >
          <ArrowLeft size={14} />
          Back
        </Link>
      </div>

      <div className="relative z-10 -mt-14 mx-auto max-w-4xl px-6 md:-mt-16 md:px-12">
        {/* ── Header: round portrait (artists are people, not posters)
            overlapping the banner, name beside it ── */}
        <div className="flex items-end gap-5">
          <div className="h-28 w-28 shrink-0 overflow-hidden rounded-full ring-4 ring-canvas md:h-36 md:w-36">
            {item.posterURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.posterURL} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-surface" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-accent">
              Music artist
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
              {item.title}
            </h1>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            onClick={toggleFollow}
            className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-[14px] font-semibold transition-all duration-200 active:scale-95 ${
              followed
                ? "bg-surface text-ink ring-1 ring-hairline hover:bg-canvas"
                : "bg-accent text-on-accent hover:brightness-110"
            }`}
          >
            {followed ? <Check size={15} /> : <Plus size={15} />}
            {followed ? "Following" : "Follow"}
          </button>
          {muted !== null && (
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next); // optimistic — resyncs on next visit
                void setItemMuted(artistID, next);
              }}
              aria-label={muted ? "Unmute alerts for this artist" : "Mute alerts for this artist"}
              title={muted ? "Alerts muted on this device — tap to unmute" : "Mute alerts for this artist on this device"}
              className={`rounded-full p-2.5 transition-colors duration-200 ${
                muted ? "bg-accent/12 text-accent" : "bg-surface text-subtle hover:text-ink"
              }`}
            >
              {muted ? <BellOff size={15} /> : <Bell size={15} />}
            </button>
          )}
          {(item.externalLinks ?? []).map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-hairline/60"
            >
              <Play size={12} className="fill-ink text-ink" />
              {l.provider}
            </a>
          ))}
        </div>

        {/* ── Next release, called out above the discography ── */}
        {next && (
          <div className="mt-8 flex items-center justify-between gap-4 rounded-xl2 bg-surface px-5 py-4 ring-1 ring-hairline">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle/80">
                Up next · {KIND_LABEL[next.kind]}
              </div>
              <div className="mt-0.5 truncate text-[16px] font-semibold text-ink">{next.title}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle/80">Drops</div>
              <div className="mt-0.5 text-[14px] font-semibold text-accent">{formatDay(next.date!)}</div>
            </div>
          </div>
        )}

        {/* ── Discography, one row per kind, each release its own card ── */}
        <div className="mt-10">
          {releases.length === 0 && (
            <p className="text-[13px] text-subtle">No releases on record yet.</p>
          )}
          {KIND_SECTIONS.map(({ kind, title }) => {
            const ofKind = releases.filter((r) => r.kind === kind);
            if (ofKind.length === 0) return null;
            return (
              <CollectionRow
                key={kind}
                title={title}
                items={ofKind.map(
                  (r, i) =>
                    ({
                      id: `${artistID}:${kind}:${i}`,
                      type: "artist",
                      title: r.title,
                      posterURL: r.coverURL,
                      releaseDate: r.date,
                    }) as MediaItem
                )}
                onSelect={() => {}}
                itemWidthClassName="w-36 sm:w-40"
                renderItem={(_, i) => <ReleaseCard release={ofKind[i]} today={todayISO} />}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// A single album/EP/single — square cover (music art is square, unlike 2:3
// posters), upcoming releases picked out with an accent ring and a "Drops"
// date instead of a plain one.
function ReleaseCard({ release, today }: { release: ReleaseGroupInfo; today: string }) {
  const upcoming = !!release.date && release.date >= today;
  return (
    <div className="flex w-full flex-col">
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-xl2 bg-surface ring-1 ${
          upcoming ? "ring-2 ring-accent/70" : "ring-hairline"
        }`}
      >
        {release.coverURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={release.coverURL} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] font-bold uppercase tracking-[0.14em] text-subtle">
            {KIND_LABEL[release.kind]}
          </div>
        )}
      </div>
      <div className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
        {release.title}
      </div>
      <div className={`mt-1 text-[12px] ${upcoming ? "font-semibold text-accent" : "text-subtle"}`}>
        {release.date ? (upcoming ? `Drops ${formatDay(release.date)}` : formatDay(release.date)) : "TBA"}
      </div>
    </div>
  );
}
