"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search as SearchIcon, Bell, Sparkles, ArrowLeft, Plus } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { addFollow, getFollowed, isFollowed, removeFollow, FollowedItem } from "@/lib/library";
import { buildFeed, describeRelease, parseReleaseDay } from "@/lib/feed";
import { enablePush, syncFollow } from "@/lib/push-client";
import type { DiscoverPayload } from "@/lib/sources";
import DetailModal from "@/components/DetailModal";
import MediaCard from "@/components/MediaCard";
import TypeTag from "@/components/TypeTag";
import CollectionCard from "@/components/CollectionCard";
import CollectionEditForm from "@/components/CollectionEditForm";
import CollectionRow from "@/components/CollectionRow";
import FeedRow from "@/components/FeedRow";
import Shelf from "@/components/Shelf";
import Sidebar, { View } from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";
import PlatformPrefs from "@/components/PlatformPrefs";
import ContentFilters from "@/components/ContentFilters";
import AmbientBackground from "@/components/AmbientBackground";
import type { ContentCategory } from "@/lib/contentFilters";
import { getHiddenCategories } from "@/lib/hiddenCategories";

const CATEGORY_TITLE: Record<string, string> = {
  movies: "Trending movies",
  tv: "Trending TV",
  games: "Trending games",
  manga: "Trending manga",
  artists: "Trending artists",
  upcoming: "Popular upcoming",
  "new-releases": "New releases",
  collections: "Explore collections",
};

const SEARCH_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tvShow", label: "TV" },
  { value: "game", label: "Games" },
  { value: "manga", label: "Manga" },
  { value: "artist", label: "Music" },
  { value: "franchise", label: "Collections" },
];

// Categories whose "see all" grid should also show the date pill — mirrors
// the Discover shelves that pass dateLabel (see below).
const DATED_CATEGORIES = new Set(["upcoming", "new-releases"]);

// A single character produces enormous, useless prefix matches ("s:*"
// against the whole catalog) — don't search until there's enough signal.
const MIN_SEARCH_CHARS = 2;
// In-memory result cache, capped — backspacing through a query re-renders
// instantly instead of refetching every prefix.
const SEARCH_CACHE_MAX = 50;

// Following page: grouped sections (in display order) and the sort applied
// within each group. "Recently followed" (default) mirrors the old flat
// list's implicit order; Title/Release date are opt-in.
const FOLLOW_GROUP_ORDER = ["movie", "tvShow", "game", "manga", "artist", "franchise"] as const;
const FOLLOW_GROUP_TITLE: Record<(typeof FOLLOW_GROUP_ORDER)[number], string> = {
  movie: "Movies",
  tvShow: "TV",
  game: "Games",
  manga: "Manga",
  artist: "Music",
  franchise: "Collections",
};
type FollowSort = "recent" | "title" | "release";
const FOLLOW_SORTS: { value: FollowSort; label: string }[] = [
  { value: "recent", label: "Recently followed" },
  { value: "title", label: "Title" },
  { value: "release", label: "Release date" },
];
function sortFollowed(items: FollowedItem[], sort: FollowSort): FollowedItem[] {
  const copy = [...items];
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "release") {
    return copy.sort((a, b) => {
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate < b.releaseDate ? -1 : 1;
    });
  }
  return copy.sort((a, b) => (a.followedAt < b.followedAt ? 1 : -1));
}

// Recap-hero copy (Nocturne Home). A TV show with a parsed next episode
// reads as a story ("Silo returns with S3 E3"), an artist with an upcoming
// release too ("Tame Impala drops Deadbeat") — the artist subtitle format is
// "Kind — Title" (see catalogRowToMediaItem's artist branch); anything else
// leads with its own title.
function heroHeadline(item: MediaItem): string {
  if (item.type === "tvShow" && item.subtitle && /^S\d+ E\d+$/.test(item.subtitle)) {
    return `${item.title} returns with ${item.subtitle}`;
  }
  if (item.type === "artist" && item.subtitle) {
    const parts = item.subtitle.split(" — ");
    if (parts.length >= 2) return `${item.title} drops ${parts.slice(1).join(" — ")}`;
  }
  return item.title;
}

// One breath of the overview, cut at a word boundary — the hero is a
// recap, not the full synopsis (that lives in the detail view).
function heroBlurb(overview?: string): string | null {
  if (!overview) return null;
  if (overview.length <= 150) return overview;
  const cut = overview.slice(0, 150);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

// Short date pill for the Discover upcoming/new-releases shelves (see
// MediaCard's dateLabel prop) — "TBA" for an upcoming item whose date isn't
// confirmed yet (upcomingTop can return those), a real short date otherwise.
function shelfDateLabel(item: MediaItem): string {
  if (!item.releaseDate) return "TBA";
  // parseReleaseDay, not new Date() — day-precision dates parsed as UTC
  // midnight read one day early in western timezones (see lib/feed.ts).
  const d = parseReleaseDay(item.releaseDate);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  // Display-only refresh of followed items' releaseDate/subtitle/posterURL,
  // fetched from the server each load (see app/api/followed/route.ts) —
  // localStorage (`followed` above) is a frozen snapshot taken at follow
  // time and stays the source of truth for WHICH items are followed;
  // followedAt never changes. This overlay is what keeps "next episode"/
  // "next release" dates from going stale without ever writing back to
  // localStorage.
  const [freshById, setFreshById] = useState<Record<string, MediaItem>>({});
  // Whether the /api/followed refresh has completed at least once for the
  // CURRENT followed list — distinguishes "haven't tried yet" (show the
  // frozen snapshot briefly rather than flash empty) from "tried, and this
  // id didn't come back" (a followed item whose id no longer resolves in
  // the catalog — see the merge logic below).
  const [freshLoaded, setFreshLoaded] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  // Discover
  const [discoverData, setDiscoverData] = useState<DiscoverPayload | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [categoryItems, setCategoryItems] = useState<MediaItem[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);

  // Settings → Content filters — read once on mount; changing it clears
  // discoverData so the next render's effect refetches under the new
  // ?hide= filter (see the ContentFilters onChange handler further down).
  const [hiddenCategories, setHiddenCategories] = useState<ContentCategory[]>([]);
  useEffect(() => setHiddenCategories(getHiddenCategories()), []);
  const hideParam = hiddenCategories.length > 0 ? `hide=${hiddenCategories.join(",")}` : "";

  // Search
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [followSort, setFollowSort] = useState<FollowSort>("recent");

  // Spotlight hero pager (Home). heroPaused goes true the moment the user
  // picks a dot themselves — from then on the reel is theirs, no auto-flip
  // fighting their choice.
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);

  useEffect(() => setFollowed(getFollowed()), []);

  const followedIdsKey = followed.map((f) => f.id).join(",");
  useEffect(() => {
    if (!followedIdsKey) return;
    setFreshLoaded(false);
    fetch(`/api/followed?ids=${encodeURIComponent(followedIdsKey)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((fresh: Record<string, MediaItem>) => setFreshById(fresh))
      .catch(() => setFreshById({}))
      .finally(() => setFreshLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIdsKey]);

  useEffect(() => {
    if (view !== "discover" || discoverData || discoverLoading) return;
    setDiscoverLoading(true);
    fetch(`/api/discover${hideParam ? `?${hideParam}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDiscoverData(d))
      .finally(() => setDiscoverLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, discoverData, discoverLoading, hideParam]);

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

  // Discover's search bar searches live as you type (debounced) rather than
  // waiting for Enter — merged Discover no longer has a separate "Search"
  // page to submit into, so the bar has to feel responsive on its own.
  useEffect(() => {
    if (query.trim().length < MIN_SEARCH_CHARS) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    const handle = setTimeout(() => void runSearch(query, searchType), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchType]);

  // Monotonic sequence guards against out-of-order responses: without it,
  // typing "sil" then "silo" could show "sil"'s results if that older
  // request happened to resolve last.
  const searchSeqRef = useRef(0);
  const searchCacheRef = useRef(new Map<string, MediaItem[]>());

  function openCategory(cat: string) {
    setCategory(cat);
    setCategoryLoading(true);
    fetch(`/api/discover?category=${cat}${hideParam ? `&${hideParam}` : ""}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategoryItems)
      .finally(() => setCategoryLoading(false));
  }

  async function runSearch(q: string, type: string) {
    const trimmed = q.trim();
    if (trimmed.length < MIN_SEARCH_CHARS) return;

    const cacheKey = `${type}|${hideParam}|${trimmed.toLowerCase()}`;
    const seq = ++searchSeqRef.current;

    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setSearchResults(cached);
      setSearchLoading(false);
      setHasSearched(true);
      return;
    }

    setSearchLoading(true);
    try {
      const base = type
        ? `/api/search?q=${encodeURIComponent(trimmed)}&type=${type}`
        : `/api/search?q=${encodeURIComponent(trimmed)}`;
      const url = hideParam ? `${base}&${hideParam}` : base;
      const res = await fetch(url);
      const results: MediaItem[] = res.ok ? await res.json() : [];
      // A newer request has been issued since this one started — drop this
      // response entirely rather than clobbering fresher results.
      if (seq !== searchSeqRef.current) return;
      searchCacheRef.current.set(cacheKey, results);
      if (searchCacheRef.current.size > SEARCH_CACHE_MAX) {
        // Map iterates in insertion order — evict the oldest entry.
        const oldest = searchCacheRef.current.keys().next().value;
        if (oldest !== undefined) searchCacheRef.current.delete(oldest);
      }
      setSearchResults(results);
    } finally {
      if (seq === searchSeqRef.current) {
        setSearchLoading(false);
        setHasSearched(true);
      }
    }
  }

  function search(e: React.FormEvent) {
    // Enter just forces an immediate fetch instead of waiting out the
    // debounce in the effect above — typing already triggers the same call.
    e.preventDefault();
    if (query.trim()) void runSearch(query, searchType);
  }

  function selectSearchType(type: string) {
    setSearchType(type);
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

  // Collections and artists open their own dedicated pages, not the generic
  // DetailModal — used everywhere a MediaItem can be clicked (feed,
  // following, discover, search) so either type routes correctly regardless
  // of where it was clicked from.
  function handleSelect(item: MediaItem) {
    if (item.type === "franchise") {
      router.push(`/collection/${item.id.slice(item.id.indexOf(":") + 1)}`);
    } else if (item.type === "artist") {
      router.push(`/artist/${item.id.slice(item.id.indexOf(":") + 1)}`);
    } else {
      setSelected(item);
    }
  }

  const freshFollowed = followed.map((f) => {
    if (freshById[f.id]) return { ...f, ...freshById[f.id], followedAt: f.followedAt };
    // Tried to refresh and this id didn't come back — its catalog entry no
    // longer resolves (a stale/orphaned follow, e.g. from before an id
    // scheme change). Trusting the old frozen releaseDate/subtitle here
    // would show confidently wrong "current" info; strip them instead so it
    // reads as "no known release info" (drops out of the date-grouped Home
    // feed entirely — see buildFeed) rather than a false date. Before the
    // fetch has resolved even once, keep showing the frozen snapshot so the
    // page doesn't flash empty.
    if (freshLoaded) return { ...f, releaseDate: undefined, subtitle: undefined };
    return f;
  });
  // Collections never belong on Home, even a followed one with a real next
  // release — the feed is about individual titles you're tracking, not
  // franchise containers. Following (the full list) still shows them.
  const homeItems = freshFollowed.filter((f) => f.type !== "franchise");

  // The recap hero: EVERY item releasing today, or — when nothing is
  // releasing today — the single nearest upcoming release as an "Up next"
  // preview. Pulled OUT of the schedule below so nothing is shown twice.
  const upcoming = homeItems
    .map((item) => ({ item, info: describeRelease(item) }))
    .filter((x): x is { item: FollowedItem; info: NonNullable<ReturnType<typeof describeRelease>> } =>
      x.info !== null && x.info.diffDays >= 0
    );
  const releasingToday = upcoming.filter((x) => x.info.diffDays === 0);
  const heroItems =
    releasingToday.length > 0
      ? releasingToday
      : upcoming.filter((x) => x.info.diffDays > 0).sort((a, b) => a.info.diffDays - b.info.diffDays).slice(0, 1);
  const heroIds = new Set(heroItems.map((x) => x.item.id));

  const feed = buildFeed(homeItems.filter((f) => !heroIds.has(f.id)));

  // Reset the spotlight whenever the set of hero items changes (a follow, a
  // date rollover, the freshness overlay landing) — a stale index could
  // otherwise point past the end of the new list.
  const heroKey = heroItems.map((x) => x.item.id).join(",");
  useEffect(() => {
    setHeroIndex(0);
    setHeroPaused(false);
  }, [heroKey]);

  // Gentle auto-advance through today's releases — skipped entirely for
  // reduced-motion users, and permanently once the user drives the dots.
  const heroCount = heroItems.length;
  useEffect(() => {
    if (heroCount <= 1 || heroPaused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setHeroIndex((i) => (i + 1) % heroCount), 6000);
    return () => clearInterval(timer);
  }, [heroCount, heroPaused, heroKey]);
  const selectedFollowed = selected ? isFollowed(selected.id) : false;

  return (
    <div className="relative min-h-screen bg-canvas">
      <AmbientBackground />
      <Sidebar
        active={view}
        onChange={(v) => {
          // Clicking "Discover" again while already there clears any active
          // search/drill-down and returns to the landing shelves, instead of
          // doing nothing (React bails out on an unchanged state).
          if (v === "discover" && view === "discover") resetSearch();
          setView(v);
          setCategory(null);
        }}
      />

      <main className="relative mx-auto max-w-4xl px-6 py-12 md:ml-64 md:px-12">
        {view === "feed" && (
          <>
            <PageHeader title="Home" subtitle="What's new with what you follow." />
            {heroItems.length === 0 && feed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="You're all caught up"
                text="Follow a movie, show, game, or manga in Discover to see release updates here."
              />
            ) : (
              <div className="space-y-10">
                {heroItems.length > 0 &&
                  (() => {
                    // Spotlight pager: every today-release gets the FULL
                    // recap treatment (big art, headline, one breath of
                    // overview), shown one at a time — dots page between
                    // them, and a slow auto-advance walks the reel until
                    // the user takes over (see the heroPaused effect above).
                    // A single item renders identically, just without the
                    // pager chrome.
                    const active = heroItems[Math.min(heroIndex, heroItems.length - 1)];
                    const { item, info } = active;
                    return (
                      <section className="animate-fade-up">
                        <div className="flex items-center">
                          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-accent">
                            {info.diffDays === 0 ? "Today" : "Up next"}
                          </div>
                          {heroItems.length > 1 && (
                            <span className="ml-3 text-[12px] font-bold text-subtle">
                              {Math.min(heroIndex, heroItems.length - 1) + 1} of {heroItems.length}
                            </span>
                          )}
                        </div>

                        {/* Keyed by item id so each page-flip re-runs the
                            fade-up entrance instead of hard-swapping. */}
                        <button
                          key={item.id}
                          onClick={() => handleSelect(item)}
                          className="group mt-4 flex w-full animate-fade-up items-center gap-6 text-left"
                        >
                          {item.posterURL ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.posterURL}
                              alt=""
                              className={`shrink-0 object-cover ${
                                item.type === "artist"
                                  ? "h-[128px] w-[128px] rounded-full"
                                  : "h-[152px] w-[104px] rounded-[12px]"
                              }`}
                            />
                          ) : (
                            <div
                              className={`shrink-0 bg-surface ${
                                item.type === "artist"
                                  ? "h-[128px] w-[128px] rounded-full"
                                  : "h-[152px] w-[104px] rounded-[12px]"
                              }`}
                            />
                          )}
                          <div className="min-w-0">
                            <h2 className="text-[24px] font-extrabold leading-tight tracking-tight text-ink">
                              {heroHeadline(item)}
                            </h2>
                            {heroBlurb(item.overview) && (
                              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-subtle">
                                {heroBlurb(item.overview)}
                              </p>
                            )}
                            <div className="mt-3.5 flex items-center gap-2.5">
                              <TypeTag type={item.type} />
                              {info.diffDays === 0 ? (
                                <span className="rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-bold text-on-accent">
                                  {info.label}
                                </span>
                              ) : (
                                <span className="text-[13px] font-semibold text-accent">{info.label}</span>
                              )}
                            </div>
                          </div>
                        </button>

                        {heroItems.length > 1 && (
                          <div className="mt-6 flex gap-2">
                            {heroItems.map((x, i) => (
                              <button
                                key={x.item.id}
                                aria-label={`Show release ${i + 1}: ${x.item.title}`}
                                onClick={() => {
                                  setHeroIndex(i);
                                  setHeroPaused(true);
                                }}
                                className={`h-1.5 w-7 rounded-full transition-colors duration-200 ${
                                  i === Math.min(heroIndex, heroItems.length - 1)
                                    ? "bg-accent"
                                    : "bg-ink/15 hover:bg-ink/30"
                                }`}
                              />
                            ))}
                          </div>
                        )}

                        {/* Center-fading hairline — the Nocturne horizon under the hero. */}
                        <div className="mt-9 h-px bg-gradient-to-r from-transparent via-ink/15 to-transparent" aria-hidden />
                      </section>
                    );
                  })()}
                {feed.map((group) => (
                  <section key={group.key}>
                    <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.2em] text-subtle">
                      {group.title}
                    </h2>
                    <div>
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
            <PageHeader title="Discover" subtitle="Search everything, or see what's trending." />
            <form
              onSubmit={search}
              className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 ring-1 ring-hairline transition-shadow focus-within:ring-2 focus-within:ring-accent/30"
            >
              <SearchIcon size={18} className="text-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search movies, TV, games, collections, and manga…"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
              />
            </form>

            {query.trim() && (
              <div className="mt-3 flex flex-wrap gap-2">
                {SEARCH_TYPE_FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => selectSearchType(value)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                      searchType === value
                        ? "bg-accent text-on-accent"
                        : "bg-surface text-subtle hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {query.trim() ? (
              <>
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
            ) : (
              <div className="mt-9">
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
                      renderItem={(item, i) => (
                        <MediaCard item={item} index={i} onSelect={handleSelect} dateLabel={shelfDateLabel(item)} />
                      )}
                    />
                    <Shelf
                      title={CATEGORY_TITLE["new-releases"]}
                      items={discoverData.newReleases}
                      onSelect={handleSelect}
                      onSeeAll={() => openCategory("new-releases")}
                      renderItem={(item, i) => (
                        <MediaCard item={item} index={i} onSelect={handleSelect} dateLabel={shelfDateLabel(item)} />
                      )}
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
                      items={discoverData.trendingGames}
                      onSelect={handleSelect}
                      onSeeAll={() => openCategory("games")}
                    />
                    <Shelf
                      title={CATEGORY_TITLE.manga}
                      items={discoverData.trendingManga}
                      onSelect={handleSelect}
                      onSeeAll={() => openCategory("manga")}
                    />
                    <Shelf
                      title={CATEGORY_TITLE.artists}
                      items={discoverData.trendingArtists}
                      onSelect={handleSelect}
                      onSeeAll={() => openCategory("artists")}
                    />
                  </>
                )}
              </div>
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
                  ) : DATED_CATEGORIES.has(category) ? (
                    <MediaCard key={item.id} item={item} index={i} onSelect={handleSelect} dateLabel={shelfDateLabel(item)} />
                  ) : (
                    <MediaCard key={item.id} item={item} index={i} onSelect={handleSelect} />
                  )
                )}
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
                text="Find something in Discover and follow it to start tracking releases."
              />
            ) : (
              <>
                <div className="mb-8 flex flex-wrap gap-2">
                  {FOLLOW_SORTS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setFollowSort(value)}
                      className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                        followSort === value
                          ? "bg-accent text-on-accent"
                          : "bg-surface text-subtle hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="space-y-9">
                  {FOLLOW_GROUP_ORDER.filter((type) => freshFollowed.some((f) => f.type === type)).map((type) => (
                    <section key={type}>
                      <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.2em] text-subtle">
                        {FOLLOW_GROUP_TITLE[type]}
                      </h2>
                      <div>
                        {sortFollowed(
                          freshFollowed.filter((f) => f.type === type),
                          followSort
                        ).map((item, i) => (
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
              </>
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
                  className="flex items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-95"
                >
                  <Bell size={14} />
                  {pushEnabled ? "Enabled" : "Enable"}
                </button>
              </SettingsRow>
              <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Preferred platforms</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    Highlighted first under &ldquo;Available on&rdquo; for anything you look up.
                  </p>
                </div>
                <PlatformPrefs />
              </div>
              <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Content filters</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    Hide categories from Discover and Search. Applies immediately.
                  </p>
                </div>
                <ContentFilters
                  onChange={(next) => {
                    setHiddenCategories(next);
                    setDiscoverData(null);
                    setSearchResults([]);
                    setHasSearched(false);
                  }}
                />
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
    <div className="flex items-center justify-between rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
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
    <div className="flex animate-fade-up flex-col items-center px-6 py-20 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface">
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
          <div className="aspect-[2/3] w-full rounded-xl2 bg-surface" />
          <div className="mt-2.5 h-3 w-4/5 rounded bg-surface" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface" />
        </div>
      ))}
    </div>
  );
}
