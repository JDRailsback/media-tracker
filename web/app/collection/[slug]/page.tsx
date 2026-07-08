"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Plus, Pencil } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import type { CollectionQueries } from "@/lib/collections";
import type { IncludedPart } from "@/lib/sources/collection";
import { addFollow, removeFollow, isFollowed as checkFollowed } from "@/lib/library";
import { syncFollow } from "@/lib/push-client";
import DetailModal from "@/components/DetailModal";
import CollectionEditForm from "@/components/CollectionEditForm";
import CollectionRow from "@/components/CollectionRow";

interface CollectionPayload {
  slug: string;
  name: string;
  tagline: string;
  theme: { primary: string; secondary: string };
  queries: CollectionQueries;
  movieCollectionId: number | null;
  featured: boolean;
  posterURL: string | null;
  bannerURL: string | null;
  logoURL: string | null;
  includeOverrides: IncludedPart[];
  excludeIds: string[];
  isCustom: boolean;
  collectionType: "thematic" | null;
  parts: { movie: MediaItem[]; tvShow: MediaItem[]; game: MediaItem[]; manga: MediaItem[] };
  mostPopular: MediaItem[];
  nextRelease: { date: string; title: string; posterURL?: string } | null;
  resolvedBannerURL?: string;
}

const SECTION_TITLE: Record<keyof CollectionPayload["parts"], string> = {
  movie: "Movies",
  tvShow: "TV",
  game: "Games",
  manga: "Manga",
};

function NavLeft({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back
      </Link>
      <button
        onClick={onEdit}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <Pencil size={13} />
        Edit
      </button>
    </div>
  );
}

function FollowButton({
  followed,
  onToggle,
}: {
  followed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all duration-200 active:scale-95 ${
        followed
          ? "bg-surface text-ink ring-1 ring-hairline hover:bg-canvas"
          : "bg-gradient-to-r from-accent to-accent-2 text-on-accent shadow-sm shadow-accent/25 hover:brightness-110"
      }`}
    >
      {followed ? <Check size={14} /> : <Plus size={14} />}
      {followed ? "Following" : "Follow"}
    </button>
  );
}

export default function CollectionPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const collectionID = `franchise:${slug}`;

  const [data, setData] = useState<CollectionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [, setFollowVersion] = useState(0);

  function load() {
    setLoading(true);
    fetch(`/api/collection/${slug}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => d && setData(d))
      .finally(() => setLoading(false));
  }

  useEffect(load, [slug]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[14px] text-subtle">
        Unknown collection.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[14px] text-subtle">
        {loading ? "Loading…" : null}
      </div>
    );
  }

  const collectionItem: MediaItem = {
    id: collectionID,
    type: "franchise",
    title: data.name,
    subtitle: data.tagline,
    releaseDate: data.nextRelease?.date,
    posterURL: data.posterURL ?? data.resolvedBannerURL ?? undefined,
    theme: data.theme,
  };
  const collectionFollowed = checkFollowed(collectionID);
  const selectedFollowed = selected ? checkFollowed(selected.id) : false;

  function toggleFollow() {
    if (collectionFollowed) {
      removeFollow(collectionID);
      void syncFollow(collectionID, false);
    } else {
      addFollow(collectionItem);
      void syncFollow(collectionID, true);
    }
    setFollowVersion((v) => v + 1);
  }

  const sections = (Object.keys(SECTION_TITLE) as (keyof CollectionPayload["parts"])[]).filter(
    (key) => data.parts[key].length > 0
  );

  const hasNextRelease = !!data.nextRelease;
  const hasMostPopular = data.mostPopular.length > 0;

  // The Back/Edit/Follow controls are embedded into the first content block:
  // the up-next card row if there is one, otherwise the first row's header.
  const navLeft = <NavLeft onEdit={() => setEditing(true)} />;
  const navRight = <FollowButton followed={collectionFollowed} onToggle={toggleFollow} />;

  return (
    <div className="min-h-screen bg-canvas">

      {/* ── Header — full-width banner, centered logo, no overlay, no text ── */}
      <div
        className="relative h-56 w-full overflow-hidden md:h-72"
        style={
          !data.resolvedBannerURL
            ? { backgroundImage: `linear-gradient(155deg, rgb(${data.theme.primary}), rgb(${data.theme.secondary}))` }
            : undefined
        }
      >
        {data.resolvedBannerURL && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.resolvedBannerURL} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          {data.logoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logoURL}
              alt={data.name}
              className="max-h-36 max-w-[65%] object-contain drop-shadow-2xl md:max-h-48 md:max-w-[55%]"
            />
          ) : (
            <h1 className="px-8 text-center text-4xl font-bold text-white drop-shadow-lg md:text-5xl">
              {data.name}
            </h1>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-16">

        {/* Up-next card — controls flank it on either side */}
        {hasNextRelease && (
          <div className="mb-10 flex items-center gap-4">
            {navLeft}

            {/* Card */}
            <div className="flex flex-1 justify-center">
              <div className="relative w-44 shrink-0 overflow-hidden rounded-xl2 shadow-lg ring-1 ring-black/[0.05] sm:w-52 dark:ring-white/[0.06]">
                <div className="aspect-[2/3]">
                  {data.nextRelease!.posterURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.nextRelease!.posterURL}
                      alt={data.nextRelease!.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-surface to-panel" />
                  )}
                </div>
                {/* Bottom overlay with title + date */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute top-2.5 left-2.5">
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-accent">
                    Up next
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-white">
                    {data.nextRelease!.title}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-white/65">
                    {new Date(data.nextRelease!.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
            </div>

            {navRight}
          </div>
        )}

        {/* Most Popular — controls in header if no up-next card */}
        {hasMostPopular && (
          <CollectionRow
            title="Most Popular"
            items={data.mostPopular}
            onSelect={setSelected}
            headerLeft={!hasNextRelease ? navLeft : undefined}
            headerRight={!hasNextRelease ? navRight : undefined}
          />
        )}

        {/* Per-type rows — controls in first row's header if no up-next and no most popular */}
        {sections.map((key, i) => (
          <CollectionRow
            key={key}
            title={SECTION_TITLE[key]}
            items={data.parts[key]}
            onSelect={setSelected}
            headerLeft={!hasNextRelease && !hasMostPopular && i === 0 ? navLeft : undefined}
            headerRight={!hasNextRelease && !hasMostPopular && i === 0 ? navRight : undefined}
          />
        ))}

        {/* Fallback: empty collection with no rows at all */}
        {!hasNextRelease && !hasMostPopular && sections.length === 0 && (
          <div className="flex items-center justify-between">
            {navLeft}
            <p className="text-[13px] text-subtle">Nothing here yet.</p>
            {navRight}
          </div>
        )}
      </div>

      {selected && (
        <DetailModal
          item={selected}
          isFollowed={selectedFollowed}
          onFollow={(full) => {
            addFollow(full);
            void syncFollow(full.id, true);
            setFollowVersion((v) => v + 1);
          }}
          onUnfollow={() => {
            removeFollow(selected.id);
            void syncFollow(selected.id, false);
            setFollowVersion((v) => v + 1);
          }}
          onClose={() => setSelected(null)}
        />
      )}

      {editing && (
        <CollectionEditForm
          mode="edit"
          slug={slug}
          isCustom={data.isCustom}
          currentParts={data.parts}
          initial={{
            name: data.name,
            tagline: data.tagline,
            theme: data.theme,
            queries: data.queries,
            movieCollectionId: data.movieCollectionId,
            featured: data.featured,
            posterURL: data.posterURL,
            bannerURL: data.bannerURL,
            logoURL: data.logoURL,
            includeOverrides: data.includeOverrides,
            excludeIds: data.excludeIds,
          }}
          onSaved={() => { setEditing(false); load(); }}
          onDeleted={() => {
            setEditing(false);
            if (data.isCustom) router.push("/");
            else load();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
