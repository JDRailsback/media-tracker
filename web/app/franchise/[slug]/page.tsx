"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Plus, Pencil } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import type { FranchiseQueries } from "@/lib/franchises";
import type { IncludedPart } from "@/lib/sources/franchise";
import { addFollow, removeFollow, isFollowed as checkFollowed } from "@/lib/library";
import { syncFollow } from "@/lib/push-client";
import DetailModal from "@/components/DetailModal";
import FranchiseEditForm from "@/components/FranchiseEditForm";
import FranchiseRow from "@/components/FranchiseRow";

interface FranchisePayload {
  slug: string;
  name: string;
  tagline: string;
  theme: { primary: string; secondary: string };
  queries: FranchiseQueries;
  movieCollectionId: number | null;
  featured: boolean;
  posterURL: string | null;
  bannerURL: string | null;
  includeOverrides: IncludedPart[];
  excludeIds: string[];
  isCustom: boolean;
  parts: { movie: MediaItem[]; tvShow: MediaItem[]; game: MediaItem[]; manga: MediaItem[] };
  mostPopular: MediaItem[];
  nextRelease: { date: string; title: string } | null;
  resolvedBannerURL?: string;
}

const SECTION_TITLE: Record<keyof FranchisePayload["parts"], string> = {
  movie: "Movies",
  tvShow: "TV",
  game: "Games",
  manga: "Manga",
};

export default function FranchisePage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const franchiseID = `franchise:${slug}`;

  const [data, setData] = useState<FranchisePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [editing, setEditing] = useState(false);
  // Bumped after any follow/unfollow so the (localStorage-backed) followed
  // checks below re-evaluate — see the identical pattern in app/page.tsx.
  const [, setFollowVersion] = useState(0);

  function load() {
    setLoading(true);
    fetch(`/api/franchise/${slug}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .finally(() => setLoading(false));
  }

  useEffect(load, [slug]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[14px] text-subtle">
        Unknown franchise.
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

  const franchiseItem: MediaItem = {
    id: franchiseID,
    type: "franchise",
    title: data.name,
    subtitle: data.tagline,
    releaseDate: data.nextRelease?.date,
    posterURL: data.posterURL ?? data.resolvedBannerURL ?? undefined,
    theme: data.theme,
  };
  const franchiseFollowed = checkFollowed(franchiseID);
  const selectedFollowed = selected ? checkFollowed(selected.id) : false;

  function toggleFranchiseFollow() {
    if (franchiseFollowed) {
      removeFollow(franchiseID);
      void syncFollow(franchiseID, false);
    } else {
      addFollow(franchiseItem);
      void syncFollow(franchiseID, true);
    }
    setFollowVersion((v) => v + 1);
  }

  const sections = (Object.keys(SECTION_TITLE) as (keyof FranchisePayload["parts"])[]).filter(
    (key) => data.parts[key].length > 0
  );

  return (
    <div className="min-h-screen bg-canvas">
      <div
        className="relative overflow-hidden px-6 py-16 md:px-16"
        style={{
          backgroundImage: `linear-gradient(155deg, rgb(${data.theme.primary}), rgb(${data.theme.secondary}))`,
        }}
      >
        {data.resolvedBannerURL && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.resolvedBannerURL}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-25 blur-sm"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
        <div className="relative mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/80 transition-colors hover:text-white"
            >
              <ArrowLeft size={15} />
              Back
            </Link>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <Pencil size={13} />
              Edit
            </button>
          </div>
          <h1 className="text-4xl font-bold text-white drop-shadow-sm">{data.name}</h1>
          <p className="mt-2 max-w-xl text-[15px] text-white/85">{data.tagline}</p>
          {data.nextRelease && (
            <p className="mt-4 text-[14px] font-semibold text-white">
              Next: {data.nextRelease.title} —{" "}
              {new Date(data.nextRelease.date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
          <button
            onClick={toggleFranchiseFollow}
            className={`mt-5 flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold transition-all duration-200 active:scale-95 ${
              franchiseFollowed
                ? "bg-white/15 text-white backdrop-blur hover:bg-white/25"
                : "bg-white text-black hover:brightness-95"
            }`}
          >
            {franchiseFollowed ? <Check size={15} /> : <Plus size={15} />}
            {franchiseFollowed ? "Following" : "Follow"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-10 md:px-16">
        {sections.length === 0 && data.mostPopular.length === 0 && (
          <p className="text-[13px] text-subtle">Nothing found for this franchise yet.</p>
        )}
        {data.mostPopular.length > 0 && (
          <FranchiseRow title="Most Popular" items={data.mostPopular} onSelect={setSelected} />
        )}
        {sections.map((key) => (
          <FranchiseRow key={key} title={SECTION_TITLE[key]} items={data.parts[key]} onSelect={setSelected} />
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
        <FranchiseEditForm
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
            includeOverrides: data.includeOverrides,
            excludeIds: data.excludeIds,
          }}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          onDeleted={() => {
            setEditing(false);
            if (data.isCustom) {
              router.push("/");
            } else {
              load();
            }
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
