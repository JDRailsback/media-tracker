"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search as SearchIcon, Bell, Sparkles, ArrowLeft, Plus } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { addFollow, getFollowed, isFollowed, removeFollow, FollowedItem } from "@/lib/library";
import { buildFeed, describeRelease } from "@/lib/feed";
import { enablePush, syncFollow } from "@/lib/push-client";
import type { DiscoverPayload } from "@/lib/sources";
import DetailModal from "@/components/DetailModal";
import MediaCard from "@/components/MediaCard";
import CollectionCard from "@/components/CollectionCard";
import CollectionEditForm from "@/components/CollectionEditForm";
import CollectionRow from "@/components/CollectionRow";
import FeedRow from "@/components/FeedRow";
import Shelf from "@/components/Shelf";
import Sidebar, { View } from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";
import PlatformPrefs from "@/components/PlatformPrefs";
import AmbientBackground from "@/components/AmbientBackground";

const CATEGORY_TITLE: Record<string, string> = {
  movies: "Trending movies",
  tv: "Trending TV",
  games: "Popular games",
  manga: "Popular manga",
  upcoming: "Popular upcoming",
  collections: "Explore collections",
};

const SEARCH_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tvShow", label: "TV" },
  { value: "game", label: "Games" },
  { value: "manga", label: "Manga" },
  { value: "franchise", label: "Collections" },
];

// See the restore/persist effects in Home() for why this exists.
const SESSION_KEY = "appViewState";
interface PersistedState {
  view: View;
  query: string;
  searchType: string;
  searchResults: MediaItem[];
  hasSearched: boolean;
  category: string | null;
  categoryItems: MediaItem[];
}

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>("feed");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [followed, setFollowed] = useState<FollowedItem[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);

  // Discover
  const [discoverData, setDiscoverData] = useState<DiscoverPayload | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [categoryItems, setCategoryItems] = useState<MediaItem[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);

  // Search
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => setFollowed(getFollowed()), []);

  useEffect(() => {
    if (view !== "discover" || discoverData || discoverLoading) return;
    setDiscoverLoading(true);
    fetch("/api/discover")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDiscoverData(d))
      .finally(() => setDiscoverLoading(false));
  }, [view, discoverData, discoverLoading]);

  // This SPA never reflects `view`/search state in the URL — it's all one
  // route ("/"). That means the browser's back button, on its own, can only
  // ever land back on "/" at its DEFAULT state (Home), even coming back from
  // a real route like /collection/[slug] — verified live that this was
  // exactly the bug: search results were lost every time. Persisting to
  // sessionStorage (not the URL) is the simplest fix that doesn't require
  // redesigning this page's routing — restored once on mount, kept in sync
  // on every change.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;
      if (saved) {
        if (saved.view) setView(saved.view);
        setQuery(saved.query ?? "");
        setSearchType(saved.searchType ?? "");
        setSearchResults(saved.searchResults ?? []);
        setHasSearched(saved.hasSearched ?? false);
        setCategory(saved.category ?? null);
        setCategoryItems(saved.categoryItems ?? []);
      }
    } catch {
      // Corrupt/unavailable sessionStorage just means starting fresh.
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return; // don't clobber saved state with defaults before it's loaded
    const state: PersistedState = {
      view,
      query,
      searchType,
      searchResults,
      hasSearched,
      category,
      categoryItems,
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      // Storage full/unavailable — losing "restore where I was" is harmless.
    }
  }, [restored, view, query, searchType, searchResults, hasSearched, category, categoryItems]);

  function openCategory(cat: string) {
    setCategory(cat);
    setCategoryLoading(true);
    fetch(`/api/discover?category=${cat}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategoryItems)
      .finally(() => setCategoryLoading(false));
  }

async function runSearch(q: string, type: string) {
    if (!q.trim()) return;
    setSearchLoading(true);
    try {
      const url = type
        ? `/api/search?q=${encodeURIComponent(q)}&type=${type}`
        : `/api/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      setSearchResults(res.ok ? await res.json() : []);
    } finally {
      setSearchLoading(false);
      setHasSearched(true);
    }
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(query, searchType);
  }

  function selectSearchType(type: string) {
    setSearchType(type);
    if (query.trim()) void runSearch(query, type);
  }

  function resetSearch() {
    setQuery("");
    setSearchType("");
    setSearchResults([]);
    setHasSearched(false);
  }

  function handleFollow(item: MediaItem) {
    addFollow(item);
    void syncFollow(item.id, true);
    setFollowed(getFollowed());
  }

  function handleUnfollow(id: string) {
    removeFollow(id);
    void syncFollow(id, false);
    setFollowed(getFollowed());
  }

  async function handleEnablePush() {
    setPushEnabled(await enablePush());
  }

  // Collections open their own themed page, not the generic DetailModal —
  // used everywhere a MediaItem can be clicked (feed, following, discover,
  // search) so a followed/discovered collection routes correctly regardless
  // of where it was clicked from.
  function handleSelect(item: MediaItem) {
    if (item.type === "franchise") {
      router.push(`/collection/${item.id.slice(item.id.indexOf(":") + 1)}`);
    } else {
      setSelected(item);
    }
  }

  const feed = buildFeed(followed);
  const selectedFollowed = selected ? isFollowed(selected.id) : false;

  return (
    <div className="relative min-h-screen bg-canvas">
      <AmbientBackground />
      <Sidebar
        active={view}
        onChange={(v) => {
          // Clicking "Search" again while already there starts a fresh search
          // instead of doing nothing (React bails out on an unchanged state).
          if (v === "search" && view === "search") resetSearch();
          setView(v);
          setCategory(null);
        }}
      />

      <main className="relative mx-auto max-w-4xl px-6 py-12 md:ml-64 md:px-12">
        {view === "feed" && (
          <>
            <PageHeader title="Home" subtitle="What's new with what you follow." />
            {feed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="You're all caught up"
                text="Follow a movie, show, game, or manga in Discover to see release updates here."
              />
            ) : (
              <div className="space-y-9">
                {feed.map((group) => (
                  <section key={group.key}>
                    <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-subtle">
                      {group.title}
                    </h2>
                    <div className="rounded-2xl border border-hairline bg-panel/70 p-1.5 shadow-sm backdrop-blur-xl">
                      {group.items.map((item, i) => (
                        <FeedRow
                          key={item.id}
                          item={item}
                          index={i}
                          badge={describeRelease(item) ?? undefined}
                          onSelect={handleSelect}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {view === "discover" && category === null && (
          <>
            <PageHeader title="Discover" subtitle="Popular picks and what's coming up next." />
            {discoverLoading && !discoverData && (
              <p className="text-[13px] text-subtle">Loading…</p>
            )}
            {discoverData && (
              <>
                <Shelf
                  title={CATEGORY_TITLE.upcoming}
                  items={discoverData.popularUpcoming}
                  onSelect={handleSelect}
                  onSeeAll={() => openCategory("upcoming")}
                />
                <div className="mb-2 flex items-center justify-end">
                  <button
                    onClick={() => setCreatingCollection(true)}
                    className="flex items-center gap-1 text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
                  >
                    <Plus size={14} />
                    New collection
                  </button>
                </div>
                <Shelf
                  title="Collections"
                  items={discoverData.featuredCollections}
                  onSelect={handleSelect}
                  onSeeAll={() => openCategory("collections")}
                  renderItem={(item, i) => <CollectionCard item={item} index={i} />}
                  itemWidthClassName="w-48 sm:w-56"
                />
                <Shelf
                  title={CATEGORY_TITLE.movies}
                  items={discoverData.trendingMovies}
                  onSelect={handleSelect}
                  onSeeAll={() => openCategory("movies")}
                />
                <Shelf
                  title={CATEGORY_TITLE.tv}
                  items={discoverData.trendingTV}
                  onSelect={handleSelect}
                  onSeeAll={() => openCategory("tv")}
                />
                <Shelf
                  title={CATEGORY_TITLE.games}
                  items={discoverData.popularGames}
                  onSelect={handleSelect}
                  onSeeAll={() => openCategory("games")}
                />
                <Shelf
                  title={CATEGORY_TITLE.manga}
                  items={discoverData.popularManga}
                  onSelect={handleSelect}
                  onSeeAll={() => openCategory("manga")}
                />
              </>
            )}
          </>
        )}

        {view === "discover" && category !== null && (
          <>
            <button
              onClick={() => setCategory(null)}
              className="mb-4 flex items-center gap-1.5 text-[13px] font-medium text-subtle transition-colors hover:text-ink"
            >
              <ArrowLeft size={15} />
              Discover
            </button>
            <div className="mb-4 flex items-center justify-between">
              <PageHeader title={CATEGORY_TITLE[category] ?? category} />
              {category === "collections" && (
                <button
                  onClick={() => setCreatingCollection(true)}
                  className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
                >
                  <Plus size={14} />
                  New collection
                </button>
              )}
            </div>
            {categoryLoading ? (
              <p className="text-[13px] text-subtle">Loading…</p>
            ) : (
              <div
                className={
                  category === "collections"
                    ? "grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3"
                    : "grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4"
                }
              >
                {categoryItems.map((item, i) =>
                  category === "collections" ? (
                    <CollectionCard key={item.id} item={item} index={i} />
                  ) : (
                    <MediaCard key={item.id} item={item} index={i} onSelect={handleSelect} />
                  )
                )}
              </div>
            )}
          </>
        )}

        {view === "search" && (
          <>
            <PageHeader title="Search" subtitle="Find anything, across every category." />
            <form
              onSubmit={search}
              className="flex items-center gap-2.5 rounded-xl border border-hairline bg-panel/70 px-4 py-3 shadow-sm backdrop-blur-xl transition-shadow focus-within:shadow-md focus-within:shadow-accent/10"
            >
              <SearchIcon size={18} className="text-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search movies, TV, games, collections, and manga…"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
              />
            </form>

            <div className="mt-3 flex flex-wrap gap-2">
              {SEARCH_TYPE_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => selectSearchType(value)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                    searchType === value
                      ? "bg-accent text-on-accent"
                      : "bg-panel/70 text-subtle hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {searchLoading && <SearchSkeleton />}

            {!searchLoading &&
              searchResults.length > 0 &&
              (() => {
                // On the "All" filter, a matched collection gets its own row
                // up top instead of being mixed into the flat media grid —
                // it's a themed collection, not a single title, and lumping
                // it in with individual movies/games/etc. reads as confusing
                // clutter. The "Collections" filter already shows ALL of them
                // in their own dedicated (wider) grid below, so this row is
                // redundant there and skipped.
                const collectionMatches = searchResults.filter((i) => i.type === "franchise");
                const showCollectionRow = searchType === "" && collectionMatches.length > 0;
                return (
                  <>
                    {showCollectionRow && (
                      <CollectionRow
                        title="Collections"
                        items={collectionMatches}
                        onSelect={handleSelect}
                        renderItem={(item, i) => <CollectionCard item={item} index={i} />}
                        itemWidthClassName="w-48 sm:w-56"
                      />
                    )}
                    <div
                      className={`${showCollectionRow ? "mt-2" : "mt-7"} grid grid-cols-2 gap-x-5 gap-y-7 ${
                        searchType === "franchise" ? "sm:grid-cols-3" : "sm:grid-cols-3 lg:grid-cols-4"
                      }`}
                    >
                      {searchResults
                        .filter((item) => searchType === "franchise" || item.type !== "franchise")
                        .map((item, i) =>
                          item.type === "franchise" ? (
                            <CollectionCard key={item.id} item={item} index={i} />
                          ) : (
                            <MediaCard key={item.id} item={item} index={i} onSelect={handleSelect} />
                          )
                        )}
                    </div>
                  </>
                );
              })()}

            {!searchLoading && hasSearched && searchResults.length === 0 && (
              <div className="mt-7">
                <EmptyState
                  icon={<SearchIcon size={22} className="text-subtle" />}
                  title="No results"
                  text={`Nothing turned up for "${query}". Try a different spelling or a broader term.`}
                />
              </div>
            )}
          </>
        )}

        {view === "following" && (
          <>
            <PageHeader
              title="Following"
              subtitle={`${followed.length} item${followed.length === 1 ? "" : "s"}.`}
            />
            {followed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="Nothing followed yet"
                text="Find something in Discover or Search and follow it to start tracking releases."
              />
            ) : (
              <div className="rounded-2xl border border-hairline bg-panel/70 p-1.5 shadow-sm backdrop-blur-xl">
                {followed.map((item, i) => (
                  <FeedRow
                    key={item.id}
                    item={item}
                    index={i}
                    badge={describeRelease(item) ?? undefined}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {view === "settings" && (
          <>
            <PageHeader title="Settings" />
            <div className="space-y-4">
              <SettingsRow label="Appearance">
                <ThemeToggle />
              </SettingsRow>
              <SettingsRow label="Notifications">
                <button
                  onClick={handleEnablePush}
                  className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1.5 text-[13px] font-semibold text-on-accent shadow-sm shadow-accent/25 transition-all duration-200 hover:brightness-110 active:scale-95"
                >
                  <Bell size={14} />
                  {pushEnabled ? "Enabled" : "Enable"}
                </button>
              </SettingsRow>
              <div className="rounded-2xl border border-hairline bg-panel/70 px-5 py-4 shadow-sm backdrop-blur-xl">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Preferred platforms</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    Highlighted first under &ldquo;Available on&rdquo; for anything you look up.
                  </p>
                </div>
                <PlatformPrefs />
              </div>
            </div>
          </>
        )}
      </main>

      {selected && (
        <DetailModal
          item={selected}
          isFollowed={selectedFollowed}
          onFollow={handleFollow}
          onUnfollow={() => handleUnfollow(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}

      {creatingCollection && (
        <CollectionEditForm
          mode="create"
          onSaved={(saved) => {
            setCreatingCollection(false);
            router.push(`/collection/${saved.slug}`);
          }}
          onClose={() => setCreatingCollection(false)}
        />
      )}
    </div>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-7 animate-fade-up">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[14px] text-subtle">{subtitle}</p>}
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-hairline bg-panel/70 px-5 py-4 shadow-sm backdrop-blur-xl">
      <span className="text-[15px] font-medium text-ink">{label}</span>
      {children}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex animate-fade-up flex-col items-center rounded-2xl border border-hairline bg-panel/70 px-6 py-16 text-center shadow-sm backdrop-blur-xl">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent/15 to-accent-2/10">
        {icon}
      </div>
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <p className="mt-1 max-w-xs text-[13.5px] text-subtle">{text}</p>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] w-full rounded-xl2 bg-gradient-to-br from-surface to-panel" />
          <div className="mt-2.5 h-3 w-4/5 rounded bg-surface" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface" />
        </div>
      ))}
    </div>
  );
}
