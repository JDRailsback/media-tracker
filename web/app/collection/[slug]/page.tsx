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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

  // Big Back/Edit (left gutter) + Follow (right gutter) buttons — flank
  // whichever content renders first (the up-next card when there is one,
  // otherwise the Most Popular row / first type row / empty-state message).
  // Never inline in a row's own header — see controlsShell below.
  const navLeftBig = (
    <div className="flex flex-col items-center justify-center gap-2">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium text-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <ArrowLeft size={16} />
        Back
      </Link>
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium text-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <Pencil size={15} />
        Edit
      </button>
    </div>
  );

  const navRightBig = (
    <button
      onClick={toggleFollow}
      className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-[15px] font-semibold transition-all duration-200 active:scale-95 ${
        collectionFollowed
          ? "bg-surface text-ink ring-1 ring-hairline hover:bg-canvas"
          : "bg-accent text-on-accent hover:brightness-110"
      }`}
    >
      {collectionFollowed ? <Check size={16} /> : <Plus size={16} />}
      {collectionFollowed ? "Following" : "Follow"}
    </button>
  );

  // Small mobile versions of the same controls — the side gutters collapse
  // away below the xl breakpoint, so these render in a row above the content instead.
  const navLeftSmall = (
    <div className="flex items-center gap-1">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back
      </Link>
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <Pencil size={13} />
        Edit
      </button>
    </div>
  );

  const navRightSmall = (
    <button
      onClick={toggleFollow}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all duration-200 active:scale-95 ${
        collectionFollowed
          ? "bg-surface text-ink ring-1 ring-hairline hover:bg-canvas"
          : "bg-accent text-on-accent hover:brightness-110"
      }`}
    >
      {collectionFollowed ? <Check size={14} /> : <Plus size={14} />}
      {collectionFollowed ? "Following" : "Follow"}
    </button>
  );

  // Wraps whichever block is the page's first piece of content in the same
  // side-gutter layout the up-next card originally had: buttons flank it in
  // the margins on desktop, sit in a row above it on mobile. The center
  // column is capped at 56rem (max-w-4xl) — same width the rest of the
  // page's content uses below it.
  function controlsShell(content: React.ReactNode) {
    return (
      <div className="py-8">
        <div className="mb-4 flex items-center justify-between px-6 xl:hidden">
          {navLeftSmall}
          {navRightSmall}
        </div>
        <div className="xl:grid" style={{ gridTemplateColumns: "1fr minmax(0, 56rem) 1fr" }}>
          <div className="hidden items-start justify-center xl:flex">{navLeftBig}</div>
          <div className="px-6 md:px-16">{content}</div>
          <div className="hidden items-start justify-center xl:flex">{navRightBig}</div>
        </div>
      </div>
    );
  }

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
        {data.logoURL && (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.logoURL}
              alt={data.name}
              className="max-h-36 max-w-[65%] object-contain drop-shadow-2xl md:max-h-48 md:max-w-[55%]"
            />
          </div>
        )}
      </div>

      {/* ── First content block — always wrapped in the side-gutter controls
          shell (Back/Edit/Follow flank it), whichever it turns out to be.
          nextRelease is currently always null now that collections resolve
          from the catalog only (no live "upcoming" data) — this branch is
          kept ready for when that's wired back up. ── */}
      {hasNextRelease
        ? controlsShell(
            <div className="flex overflow-hidden rounded-xl2 bg-surface ring-1 ring-hairline">
              {/* Poster — bleeds to the left card edge */}
              <div className="relative w-[4.5rem] shrink-0 self-stretch sm:w-24">
                {data.nextRelease!.posterURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.nextRelease!.posterURL} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-canvas" />
                )}
              </div>
              <div className="w-px shrink-0 bg-hairline" />
              <div className="flex flex-1 flex-col justify-center px-5 py-5">
                <span className="mb-2 inline-flex w-fit rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-accent">
                  Up next
                </span>
                <p className="line-clamp-2 text-[16px] font-semibold leading-snug text-ink">
                  {data.nextRelease!.title}
                </p>
                <p className="mt-2 text-[13px] text-subtle">{formatDate(data.nextRelease!.date)}</p>
              </div>
            </div>
          )
        : hasMostPopular
        ? controlsShell(<CollectionRow title="Most Popular" items={data.mostPopular} onSelect={setSelected} />)
        : sections.length > 0
        ? controlsShell(
            <CollectionRow title={SECTION_TITLE[sections[0]]} items={data.parts[sections[0]]} onSelect={setSelected} />
          )
        : controlsShell(<p className="text-[13px] text-subtle">Nothing here yet.</p>)}

      {/* ── Remaining content, plain rows, no header buttons ── */}
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-16">
        {hasNextRelease && hasMostPopular && (
          <CollectionRow title="Most Popular" items={data.mostPopular} onSelect={setSelected} />
        )}
        {(!hasNextRelease && !hasMostPopular && sections.length > 0 ? sections.slice(1) : sections).map((key) => (
          <CollectionRow key={key} title={SECTION_TITLE[key]} items={data.parts[key]} onSelect={setSelected} />
        ))}
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
