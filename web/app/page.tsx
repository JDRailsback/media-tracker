"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search as SearchIcon, Bell, Sparkles, ArrowLeft, Plus, X, Calendar as CalendarIcon, Play } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { WATCHLIST_LABEL, type DugoutGroups, type DugoutStatus, type DugoutType } from "@/lib/dugout";
import { addFollow, getFollowed, isFollowed, removeFollow, replaceFollowed, FollowedItem } from "@/lib/library";
import { buildFeed, describeRelease, parseReleaseDay } from "@/lib/feed";
import { currentSubscription, disablePush, enablePush, fetchPrefs, syncFollow } from "@/lib/push-client";
import { getReadIds, markRead, timeAgo } from "@/lib/notificationHistory";
import { LEAD_TIME_OPTIONS } from "@/lib/notificationPrefs";
import TypeMutes from "@/components/TypeMutes";
import CalendarSync from "@/components/CalendarSync";
import AccountSettings from "@/components/AccountSettings";
import type { DiscoverPayload } from "@/lib/sources";
import DetailModal from "@/components/DetailModal";
import MediaCard from "@/components/MediaCard";
import TypeTag from "@/components/TypeTag";
import CollectionCard from "@/components/CollectionCard";
import CollectionEditForm from "@/components/CollectionEditForm";
import CollectionRow from "@/components/CollectionRow";
import FeedRow from "@/components/FeedRow";
import Shelf from "@/components/Shelf";
import MonthCalendarGrid, { dayKey, type CalendarEntry } from "@/components/MonthCalendarGrid";
import { releaseEntriesFor } from "@/lib/releaseEntries";
import Sidebar, { View } from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import AccountCorner from "@/components/AccountCorner";
import ThemeToggle from "@/components/ThemeToggle";
import PlatformPrefs from "@/components/PlatformPrefs";
import ContentFilters from "@/components/ContentFilters";
import IntlBarSetting from "@/components/IntlBarSetting";
import GeneralBarSetting from "@/components/GeneralBarSetting";
import AmbientBackground from "@/components/AmbientBackground";
import type { ContentCategory } from "@/lib/contentFilters";
import { getHiddenCategories } from "@/lib/hiddenCategories";
import { getIntlBarLevel, type IntlBarLevel } from "@/lib/intlBar";
import { getGeneralBarLevel, type GeneralBarLevel } from "@/lib/generalBar";
import { getFreshCache, setFreshCache } from "@/lib/freshCache";
import { getDiscoverCache, setDiscoverCache } from "@/lib/discoverCache";

// Manga is intentionally absent site-wide (explicit request, flagged as
// something to potentially re-add later; see lib/discoverSnapshot.ts's
// DiscoverPayload comment) — Discover/Search, Following (FOLLOW_GROUP_ORDER/
// TITLE below), and Settings (contentFilters/notificationPrefs/
// platformPrefs) all exclude it now. A followed manga item from before this
// simply won't have a section to render into anymore.
const CATEGORY_TITLE: Record<string, string> = {
  movies: "Trending movies",
  tv: "Trending TV",
  games: "Trending games",
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

// One row of /api/notifications' response — see that route for field docs.
interface NotificationEntry {
  id: number;
  itemID: string;
  eventType: string;
  leadDays: number;
  releaseDate: string;
  title: string;
  subtitle?: string;
  message: string;
  createdAt: string;
}

const VALID_VIEWS = new Set<View>(["feed", "discover", "following", "calendar", "dugout", "notifications", "settings"]);

// Following page: grouped sections (in display order) and the sort applied
// within each group. "Recently followed" (default) mirrors the old flat
// list's implicit order; Title/Release date are opt-in.
const FOLLOW_GROUP_ORDER = ["movie", "tvShow", "game", "artist", "franchise"] as const;
const FOLLOW_GROUP_TITLE: Record<(typeof FOLLOW_GROUP_ORDER)[number], string> = {
  movie: "Movies",
  tvShow: "TV",
  game: "Games",
  artist: "Music",
  franchise: "Collections",
};
// Dugout: per-type tab label, "on deck" copy noun, and the verb used in
// the page subtitle — "watch"/"play"/"listen to" reads more natural than a
// one-size-fits-all "watch" once games and music are in the mix.
const DUGOUT_TYPES = ["movie", "tvShow", "game", "artist"] as const;
const DUGOUT_TYPE_LABEL: Record<DugoutType, string> = {
  movie: "Movies",
  tvShow: "TV",
  game: "Games",
  artist: "Music",
};
const DUGOUT_TYPE_NOUN: Record<DugoutType, string> = {
  movie: "movies",
  tvShow: "shows",
  game: "games",
  artist: "artists",
};
// Same nouns, spelled out for the search modal's "Search for ___" copy,
// where "shows" alone reads ambiguous.
const DUGOUT_TYPE_SEARCH_NOUN: Record<DugoutType, string> = {
  movie: "movies",
  tvShow: "TV shows",
  game: "games",
  artist: "artists",
};
const DUGOUT_TYPE_VERB: Record<DugoutType, string> = {
  movie: "watch",
  tvShow: "watch",
  game: "play",
  artist: "listen to",
};
// Only tvShow and game have a meaningful "currently in progress" state —
// see lib/dugout.ts's DugoutGroups comment.
const DUGOUT_IN_PROGRESS_LABEL: Partial<Record<DugoutType, string>> = {
  tvShow: "Currently watching",
  game: "Currently playing",
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
  // Year only when it's not the current year — "Feb 1" reads as "coming up"
  // for a same-year date, but silently means 2027 for a title over a year
  // out (verified live: a "Popular upcoming" list spanning into next year
  // showed dates like "Feb 1" with no way to tell it wasn't a few weeks
  // away). Compared against real "now," not the item's own year, so a title
  // that slips from next year into this one relabels correctly on its own.
  const showYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, showYear ? { year: "numeric", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
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
  const { data: session, status: sessionStatus } = useSession();
  const isAdmin = !!session?.user?.isAdmin;
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

  // Dugout — "what to watch next", movie/TV only. Server-backed (see
  // lib/dugout.ts), so unlike Following/Discover there's no localStorage or
  // once-per-session cache to hydrate from: it refetches every time the
  // user visits the view or switches the Movies/TV toggle, and again after
  // the detail modal closes (a status change made there wouldn't otherwise
  // be reflected until the next full navigation). The dataset is small
  // (a single-user queue capped at 5 On Deck + a modest watchlist), so
  // there's no staleness-vs-cost tradeoff worth making here.
  const [dugoutType, setDugoutType] = useState<DugoutType>("movie");
  const [dugoutData, setDugoutData] = useState<DugoutGroups | null>(null);
  const [dugoutLoading, setDugoutLoading] = useState(false);

  function refetchDugout() {
    setDugoutLoading(true);
    fetch(`/api/dugout?type=${dugoutType}`)
      .then((r) => (r.ok ? r.json() : { onDeck: [], watchlist: [], currentlyWatching: [] }))
      .then(setDugoutData)
      .finally(() => setDugoutLoading(false));
  }

  useEffect(() => {
    if (view !== "dugout") return;
    refetchDugout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dugoutType]);

  // Home's "Continue" rail — currentlyWatching across both types that
  // support it (tvShow/game), flattened by /api/dugout?continue=1. Fetched
  // once on mount rather than gated on `view === "feed"`: Home is the
  // default landing view, so gating on it would mean the rail (and the
  // layout reflow it causes) pops in a beat after the page itself does.
  // Refetched after the detail modal closes, same "a status change made
  // there wouldn't otherwise be reflected" reasoning as refetchDugout.
  const [continueItems, setContinueItems] = useState<MediaItem[]>([]);
  function refetchContinueWatching() {
    fetch("/api/dugout?continue=1")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: MediaItem[] }) => setContinueItems(d.items))
      .catch(() => {});
  }
  useEffect(refetchContinueWatching, []);

  // Search directly from Dugout — a lighter-weight sibling of Discover's
  // search (query/searchType/searchResults above), not a reuse of it:
  // that state is tied to the Discover view's own render branch and
  // persisted to sessionStorage as part of it, so sharing it would mean a
  // Dugout search overwrites whatever the user had searched in Discover
  // (and vice versa) the moment either view remounts. This only ever
  // searches ONE type — whichever the Movies/TV toggle is currently on —
  // so it skips the "All types" case and the cross-session cache entirely.
  // A popup rather than a bar sitting permanently on the page — Dugout is
  // meant to be a quick "what's queued up" glance, not another search
  // surface competing with Discover's for space. The target (which status a
  // selected result gets added AS) is set by which section's "+" opened it
  // — there's no separate "search, then choose" step: clicking a result
  // adds it immediately (see handleDugoutSearchSelect below), unlike the
  // DetailModal flow used everywhere else, which is deliberately a
  // browse-first, add-second experience. Dugout's own search button is the
  // one place "search" and "add" are meant to be the same click.
  const [dugoutSearchTarget, setDugoutSearchTarget] = useState<DugoutStatus | null>(null);
  const [dugoutQuery, setDugoutQuery] = useState("");
  const [dugoutSearchResults, setDugoutSearchResults] = useState<MediaItem[]>([]);
  const [dugoutSearching, setDugoutSearching] = useState(false);
  const [dugoutAdding, setDugoutAdding] = useState(false);
  const [dugoutAddError, setDugoutAddError] = useState<string | null>(null);
  const dugoutSearchSeqRef = useRef(0);

  function closeDugoutSearch() {
    setDugoutSearchTarget(null);
    setDugoutQuery(""); // next open starts fresh rather than showing a stale query/results
    setDugoutAddError(null);
  }

  async function handleDugoutSearchSelect(item: MediaItem) {
    if (!dugoutSearchTarget) return;
    setDugoutAddError(null);
    setDugoutAdding(true);
    try {
      const res = await fetch("/api/dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemID: item.id, status: dugoutSearchTarget }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }
      closeDugoutSearch();
      refetchDugout();
    } catch (err) {
      // Left open on failure (e.g. On Deck already at 5) — the error shows
      // inline so the user can pick something else or bail out themselves.
      setDugoutAddError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDugoutAdding(false);
    }
  }

  useEffect(() => {
    if (!dugoutSearchTarget) return;
    const trimmed = dugoutQuery.trim();
    if (trimmed.length < MIN_SEARCH_CHARS) {
      setDugoutSearchResults([]);
      setDugoutSearching(false);
      return;
    }
    const seq = ++dugoutSearchSeqRef.current;
    const handle = setTimeout(async () => {
      setDugoutSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&type=${dugoutType}`);
        const results: MediaItem[] = res.ok ? await res.json() : [];
        if (seq !== dugoutSearchSeqRef.current) return; // a newer query superseded this one
        setDugoutSearchResults(results);
      } finally {
        if (seq === dugoutSearchSeqRef.current) setDugoutSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dugoutQuery, dugoutType, dugoutSearchTarget]);

  // Discover. Hydrated from last session's cache so the shelves render
  // instantly on the first visit this session instead of blanking behind
  // "Loading…" — discoverFetched (NOT discoverData) is what actually gates
  // the fetch effect below, so the cache is purely a stand-in until the
  // real fetch lands, never a substitute for it (see freshCache.ts for the
  // identical pattern on Home).
  const [discoverData, setDiscoverData] = useState<DiscoverPayload | null>(() => getDiscoverCache());
  const [discoverFetched, setDiscoverFetched] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [categoryItems, setCategoryItems] = useState<MediaItem[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  // "upcoming" is the one category page meant to be browsed hundreds deep
  // (infinite scroll) rather than a single fixed-size grid — see
  // loadMoreUpcoming below and lib/upcoming.ts's upcomingBrowse.
  // categoryPageRef is a page NUMBER (matching the API's fixed per-page slot
  // count, not an item offset — see the API route's comment on why
  // item-count offsets would drift out of sync with upcomingBrowse's
  // per-type windows) — a ref, not state, since it's read synchronously
  // inside loadMoreUpcoming's re-entrancy guard (see there for why).
  const categoryPageRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [categoryHasMore, setCategoryHasMore] = useState(false);
  const [categoryLoadingMore, setCategoryLoadingMore] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);

  // Settings → Content filters — read once on mount; changing it clears
  // discoverData so the next render's effect refetches under the new
  // ?hide= filter (see the ContentFilters onChange handler further down).
  const [hiddenCategories, setHiddenCategories] = useState<ContentCategory[]>([]);
  useEffect(() => setHiddenCategories(getHiddenCategories()), []);
  const hideParam = hiddenCategories.length > 0 ? `hide=${hiddenCategories.join(",")}` : "";

  // Settings → Popular upcoming's international bar (see lib/intlBar.ts) —
  // same read-once-on-mount, clear-and-refetch pattern as hiddenCategories.
  const [intlBar, setIntlBar] = useState<IntlBarLevel>("moderate");
  useEffect(() => setIntlBar(getIntlBarLevel()), []);
  const intlBarParam = `intlBar=${intlBar}`;

  // Settings → Popular upcoming's general bar (see lib/generalBar.ts) —
  // same pattern, but applies regardless of language.
  const [generalBar, setGeneralBar] = useState<GeneralBarLevel>("moderate");
  useEffect(() => setGeneralBar(getGeneralBarLevel()), []);
  const generalBarParam = `generalBar=${generalBar}`;

  // Combined query string for every Discover-family fetch — both bar params
  // are always present (they have real defaults), hideParam only when
  // non-empty.
  const discoverParams = [intlBarParam, generalBarParam, hideParam].filter(Boolean).join("&");

  // Search
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [followSort, setFollowSort] = useState<FollowSort>("recent");
  // Followed-items calendar (sidebar "Calendar" tab) — month displayed, not
  // fetched: everything upcoming for a followed item comes from freshFollowed
  // already in memory (see followedCalendarEntries below), so switching
  // months is pure client-side filtering, no request.
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth() + 1);

  // Spotlight hero pager (Home). heroPaused goes true the moment the user
  // picks a dot themselves — from then on the reel is theirs, no auto-flip
  // fighting their choice.
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);

  // Notifications — fetched on mount regardless of active view so the
  // Sidebar's unread badge is accurate everywhere. readIds mirrors the
  // localStorage read-set (lib/notificationHistory.ts); unreadAtOpenRef
  // snapshots which rows were unread the moment the view opened, so the
  // unread dots stay visible during the visit even though everything is
  // marked read immediately (which is what clears the badge).
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [readIds, setReadIds] = useState<number[]>([]);
  const unreadAtOpenRef = useRef<Set<number>>(new Set());
  // Guards the mark-read effect below so it only snapshots/marks once per
  // *visit* to the view, not on every notifications-array change while
  // already there (e.g. clearing one entry) — see that effect's comment.
  const notificationsMarkedRef = useRef(false);
  // null = push not enabled on this device (controls show their hint state).
  const [leadTime, setLeadTime] = useState<number | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    setFollowed(getFollowed());
    // Hydrate the freshness overlay from the LAST session's fetch before
    // this session's fetch resolves (stale-while-revalidate). Without it,
    // any item whose frozen follow-time snapshot has a past date — every
    // weekly TV show, within a week of following — vanished from Home for
    // the seconds the refresh took, then popped in (verified live).
    setFreshById(getFreshCache());
  }, []);

  // Once signed in, the account's server-side follows replace whatever's
  // local (see lib/library.ts's replaceFollowed) — the account becomes the
  // source of truth, localStorage its synced cache. Runs once per sign-in
  // (gated on sessionStatus transitioning to "authenticated"), not on every
  // render, so it doesn't stomp on follows made during the same session.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetch("/api/followed/mine")
      .then((r) => (r.ok ? r.json() : null))
      .then((items: FollowedItem[] | null) => {
        if (!items) return;
        replaceFollowed(items);
        setFollowed(getFollowed());
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  const followedIdsKey = followed.map((f) => f.id).join(",");
  useEffect(() => {
    if (!followedIdsKey) return;
    setFreshLoaded(false);
    fetch(`/api/followed?ids=${encodeURIComponent(followedIdsKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((fresh: Record<string, MediaItem> | null) => {
        // On failure, keep whatever we're already showing (the hydrated
        // cache) — clobbering to {} would blank the page on a bad network.
        if (!fresh) return;
        setFreshById(fresh);
        setFreshCache(fresh);
      })
      .catch(() => {})
      .finally(() => setFreshLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIdsKey]);

  // One-time backfill: follows made before the server accepted push-less
  // registration (see /api/follow) have no followed_items row, so the poll
  // can't log history for them. Re-sync every local follow once; the flag
  // is set FIRST so a mid-run reload can't spam duplicate posts (the calls
  // are idempotent upserts anyway — the flag just avoids the traffic).
  useEffect(() => {
    if (followed.length === 0) return;
    if (localStorage.getItem("serverFollowsSynced") === "1") return;
    localStorage.setItem("serverFollowsSynced", "1");
    for (const f of followed) void syncFollow(f.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIdsKey]);

  function refreshNotifications() {
    setReadIds(getReadIds());
    if (!followedIdsKey) {
      setNotifications([]);
      return;
    }
    fetch(`/api/notifications?ids=${encodeURIComponent(followedIdsKey)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: NotificationEntry[]) => setNotifications(rows))
      .catch(() => {});
  }

  useEffect(() => {
    refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIdsKey]);

  // Returning to the tab (e.g. the daily poll ran while it was in the
  // background) previously never refreshed notifications on its own — only
  // a change to the follow list did, so the badge/list could sit stale for
  // an entire session. This keeps them current without a manual reload.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") refreshNotifications();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIdsKey]);

  // Opening the Notifications view marks everything read (clears the
  // badge) — after snapshotting what WAS unread so the in-list dots
  // survive the visit. Gated on notificationsMarkedRef, not just
  // `notifications.length > 0`, so this runs exactly ONCE per visit — it
  // used to depend on the `notifications` array directly, which meant
  // clearing a single entry (a new array reference) re-ran this, recomputed
  // "unread" from the now-all-read localStorage state, and silently wiped
  // the unread dots for every OTHER still-unread row in the list mid-visit.
  useEffect(() => {
    if (view !== "notifications") {
      notificationsMarkedRef.current = false;
      return;
    }
    if (notificationsMarkedRef.current || notifications.length === 0) return;
    notificationsMarkedRef.current = true;
    const read = new Set(getReadIds());
    unreadAtOpenRef.current = new Set(notifications.filter((n) => !read.has(n.id)).map((n) => n.id));
    markRead(notifications.map((n) => n.id));
    setReadIds(getReadIds());
  }, [view, notifications]);

  // Reflect existing push state in Settings (previously the Enable button
  // always started as "Enable" even when push was already on), and hydrate
  // the reminder lead-time from this device's stored prefs.
  useEffect(() => {
    currentSubscription().then((sub) => {
      if (!sub) return;
      setPushEnabled(true);
      fetchPrefs().then((p) => p && setLeadTime(p.leadTimeDays));
    });
  }, []);

  useEffect(() => {
    // Gated on discoverFetched, NOT discoverData — cached data from a
    // previous session already fills discoverData on mount (see its lazy
    // initializer above), but that's stale-while-revalidate filler, not a
    // reason to skip the real fetch. Once this session's own fetch lands,
    // discoverFetched stops it from ever refiring for the rest of the visit
    // (matches the app's existing "fetch once per session" behavior).
    if (view !== "discover" || discoverFetched || discoverLoading) return;
    setDiscoverLoading(true);
    fetch(`/api/discover?${discoverParams}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setDiscoverData(d);
        setDiscoverCache(d);
      })
      .finally(() => {
        setDiscoverLoading(false);
        setDiscoverFetched(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, discoverFetched, discoverLoading, discoverParams]);

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
      // Push-notification deep link (/?view=notifications — see /api/poll's
      // payload url): a one-shot override of whatever view was restored,
      // then scrubbed from the URL so a refresh doesn't re-trigger it. The
      // override is ALSO written into the sessionStorage state before the
      // scrub — React 18's dev double-mount re-runs this effect after the
      // URL is already clean, and without the write the second run would
      // restore the old saved view right over the deep link (verified live).
      const urlView = new URLSearchParams(window.location.search).get("view") as View | null;
      if (urlView && VALID_VIEWS.has(urlView)) {
        setView(urlView);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...(saved ?? {}), view: urlView }));
        window.history.replaceState({}, "", "/");
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
    setCategoryItems([]);
    categoryPageRef.current = 0;
    loadingMoreRef.current = false;
    setCategoryHasMore(false);
    setCategoryLoading(true);
    fetch(`/api/discover?category=${cat}&${discoverParams}`)
      .then((r) => {
        if (cat === "upcoming") setCategoryHasMore(r.headers.get("X-Has-More") === "true");
        return r.ok ? r.json() : [];
      })
      .then(setCategoryItems)
      .finally(() => setCategoryLoading(false));
  }

  // "Popular upcoming" is the one See all page meant to be a full,
  // hundreds-deep release calendar rather than a fixed-size grid (see
  // lib/upcoming.ts's upcomingBrowse) — this appends the next page instead
  // of replacing categoryItems, driven by the scroll listener below.
  //
  // loadingMoreRef is a SYNCHRONOUS re-entrancy guard, not just the
  // categoryLoadingMore state — React state updates aren't visible until the
  // next render, so two scroll events firing back-to-back (verified live:
  // React 18 dev-mode's effect double-invocation briefly attaches the
  // scroll listener twice) could both read categoryLoadingMore as still
  // false and both fire a fetch for the same nextPage, appending every item
  // on that page twice. The id-based filter on append is a second,
  // independent safety net against the same failure mode.
  function loadMoreUpcoming() {
    if (loadingMoreRef.current || !categoryHasMore) return;
    loadingMoreRef.current = true;
    const nextPage = categoryPageRef.current + 1;
    setCategoryLoadingMore(true);
    fetch(`/api/discover?category=upcoming&page=${nextPage}&${discoverParams}`)
      .then(async (r) => {
        setCategoryHasMore(r.headers.get("X-Has-More") === "true");
        const items: MediaItem[] = r.ok ? await r.json() : [];
        setCategoryItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...items.filter((i) => !seen.has(i.id))];
        });
        categoryPageRef.current = nextPage;
      })
      .finally(() => {
        setCategoryLoadingMore(false);
        loadingMoreRef.current = false;
      });
  }

  useEffect(() => {
    if (category !== "upcoming") return;
    function onScroll() {
      const nearBottom = document.documentElement.scrollHeight - (window.innerHeight + window.scrollY) < 600;
      if (nearBottom) loadMoreUpcoming();
    }
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, categoryHasMore, categoryLoadingMore]);

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

  // Was enable-only forever — clicking "Enabled" again just silently
  // re-subscribed with the same endpoint. Now a real toggle, and errors
  // (permission denied, unsupported browser, missing VAPID key) surface
  // instead of leaving the button stuck on "Enable" with no explanation.
  async function handleTogglePush() {
    setPushError(null);
    if (pushEnabled) {
      await disablePush();
      setPushEnabled(false);
      setLeadTime(null);
      return;
    }
    try {
      const ok = await enablePush();
      setPushEnabled(ok);
      if (ok) {
        // A brand-new subscription starts with default prefs — hydrate the
        // lead-time control so it goes live without a reload.
        fetchPrefs().then((p) => p && setLeadTime(p.leadTimeDays));
      } else {
        setPushError("Notifications permission was denied, or this browser doesn't support push.");
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Couldn't enable notifications.");
    }
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

  // Optimistic: drop from local state immediately, fire the DELETE without
  // waiting — this is an inbox, not a record that needs strict consistency,
  // and re-fetching on every clear would just add latency to a delete click.
  // Rolled back on failure instead of just swallowing the error, so a
  // dropped request doesn't leave the row permanently (and silently) gone
  // from this session's view. itemID rides along because the server now
  // requires it — see app/api/notifications' DELETE comment.
  function handleClearNotification(id: number) {
    const removed = notifications.find((n) => n.id === id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, itemID: removed?.itemID }),
    })
      .then((r) => {
        if (!r.ok && removed) setNotifications((prev) => [...prev, removed].sort((a, b) => b.id - a.id));
      })
      .catch(() => {
        if (removed) setNotifications((prev) => [...prev, removed].sort((a, b) => b.id - a.id));
      });
  }

  function handleClearAllNotifications() {
    if (notifications.length === 0) return;
    if (!window.confirm("Clear all notifications? This can't be undone.")) return;
    const previous = notifications;
    setNotifications([]);
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: followedIdsKey.split(",") }),
    })
      .then((r) => {
        if (!r.ok) setNotifications(previous);
      })
      .catch(() => setNotifications(previous));
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

  // Sidebar "Calendar" tab: every followed item's release date(s), past and
  // future, grouped by day. releaseEntriesFor (lib/releaseEntries.ts) is
  // the shared source of truth for "what dates does this item actually
  // have" — same function the ICS feed (app/api/calendar/feed.ics) uses, so
  // the in-app calendar and the exported calendar can never drift apart.
  const followedCalendarEntries = new Map<string, CalendarEntry[]>();
  {
    const push = (key: string, entry: CalendarEntry) => {
      const list = followedCalendarEntries.get(key);
      if (list) list.push(entry);
      else followedCalendarEntries.set(key, [entry]);
    };
    for (const item of homeItems) {
      for (const entry of releaseEntriesFor(item)) {
        push(dayKey(parseReleaseDay(entry.date)), {
          key: entry.uidSuffix ? `${item.id}:${entry.uidSuffix}` : item.id,
          title: entry.title,
          subtitle: entry.subtitle,
          posterURL: item.posterURL,
          type: item.type,
          onSelect: () => handleSelect(item),
        });
      }
    }
  }

  // The recap hero: EVERY item releasing today, and nothing else — no
  // "nearest upcoming" fallback when nothing's releasing today; the hero
  // simply doesn't render (see heroItems.length > 0 checks below). Pulled
  // OUT of the schedule below so nothing is shown twice.
  const heroItems = homeItems
    .map((item) => ({ item, info: describeRelease(item) }))
    .filter((x): x is { item: FollowedItem; info: NonNullable<ReturnType<typeof describeRelease>> } =>
      x.info !== null && x.info.diffDays === 0
    )
    .sort((a, b) => {
      // Every item here is already "today" — order by exact release time
      // when one's known (a TV episode with a TVmaze airstamp), untimed
      // releases (movies/games — just "today") first. Same tie-break
      // buildFeed already uses for same-day items below; this list was
      // previously unsorted, so the pager reflected follow order instead
      // of actual release order.
      const aAt = a.item.releaseAt;
      const bAt = b.item.releaseAt;
      if (!aAt && !bAt) return 0;
      if (!aAt) return -1;
      if (!bAt) return 1;
      return new Date(aAt).getTime() - new Date(bAt).getTime();
    });
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
      {(() => {
        const handleNavChange = (v: View) => {
          // Clicking "Discover" again while already there clears any active
          // search/drill-down and returns to the landing shelves, instead of
          // doing nothing (React bails out on an unchanged state).
          if (v === "discover" && view === "discover") resetSearch();
          setView(v);
          setCategory(null);
        };
        const unreadCount = notifications.filter((n) => !readIds.includes(n.id)).length;
        return (
          <>
            <Sidebar active={view} unreadCount={unreadCount} onChange={handleNavChange} />
            <MobileNav active={view} unreadCount={unreadCount} onChange={handleNavChange} />
            <AccountCorner onOpenAccount={() => handleNavChange("settings")} />
          </>
        );
      })()}

      <main
        className={`relative mx-auto px-6 pb-28 pt-12 md:ml-64 md:px-12 md:pb-12 ${
          // Calendar gets a bounded, non-scrolling height (see
          // components/MonthCalendarGrid.tsx's comment) — every other view
          // keeps main's ordinary content-sized/scrollable flow, so this
          // must stay scoped to just that one view's classes. Home gets a
          // touch more width than the rest — just enough that the Continue
          // rail (see the "feed" view below) doesn't squeeze the release
          // feed to fit inside the same max-w-4xl every other view uses.
          view === "calendar" ? "flex h-dvh max-w-7xl flex-col" : view === "feed" ? "max-w-5xl" : "max-w-4xl"
        }`}
      >
        {view === "feed" && (
          <>
            <PageHeader title="Home" subtitle="What's new with what you follow." />
            {heroItems.length === 0 && feed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="You're all caught up"
                text="Follow a movie, show, or game in Discover to see release updates here."
              />
            ) : (
              <div className={continueItems.length > 0 ? "md:grid md:grid-cols-[1fr_208px] md:gap-10" : ""}>
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
                            Today
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
                {continueItems.length > 0 && (
                  <ContinueStrip items={continueItems} onSelect={handleSelect} />
                )}
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
              {continueItems.length > 0 && (
                <ContinueRail
                  items={continueItems}
                  onSelect={handleSelect}
                  onSeeAll={() => setView("dugout")}
                />
              )}
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
                placeholder="Search movies, TV, games, and collections…"
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
                    <div className="mb-2 flex items-center justify-end">
                      <button
                        onClick={() => router.push("/calendar")}
                        className="flex items-center gap-1 text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
                      >
                        <CalendarIcon size={14} />
                        Calendar view
                      </button>
                    </div>
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
                    {isAdmin && (
                      <div className="mb-2 flex items-center justify-end">
                        <button
                          onClick={() => setCreatingCollection(true)}
                          className="flex items-center gap-1 text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
                        >
                          <Plus size={14} />
                          New collection
                        </button>
                      </div>
                    )}
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
              {category === "collections" && isAdmin && (
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
            {!categoryLoading && category === "upcoming" && categoryLoadingMore && (
              <p className="mt-6 text-center text-[13px] text-subtle">Loading more…</p>
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

        {view === "calendar" && (
          <>
            <PageHeader
              title="Calendar"
              subtitle="Every release and episode you're following, laid out by month."
            />
            {homeItems.length === 0 ? (
              <EmptyState
                icon={<CalendarIcon size={22} className="text-subtle" />}
                title="Nothing followed yet"
                text="Find something in Discover and follow it to see it here."
              />
            ) : (
              <div className="min-h-0 flex-1">
                <MonthCalendarGrid
                  year={calYear}
                  month={calMonth}
                  onMonthChange={(delta) => {
                    const d = new Date(calYear, calMonth - 1 + delta, 1);
                    setCalYear(d.getFullYear());
                    setCalMonth(d.getMonth() + 1);
                  }}
                  onToday={() => {
                    const now = new Date();
                    setCalYear(now.getFullYear());
                    setCalMonth(now.getMonth() + 1);
                  }}
                  entriesByDay={followedCalendarEntries}
                  emptyMessage="Nothing releasing this month."
                />
              </div>
            )}
          </>
        )}

        {view === "dugout" && (
          <>
            <div className="mb-1 flex animate-fade-up items-center justify-between gap-3">
              <h1 className="text-[30px] font-extrabold tracking-tight text-ink">
                Dug<span className="text-accent">out</span>
              </h1>
              <div className="flex gap-2">
                {DUGOUT_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setDugoutType(t)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                      dugoutType === t ? "bg-accent text-on-accent" : "bg-surface text-subtle hover:text-ink"
                    }`}
                  >
                    {DUGOUT_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-8 animate-fade-up text-[14px] text-subtle">
              Line up what you want to {DUGOUT_TYPE_VERB[dugoutType]} next.
            </p>

            {dugoutLoading && !dugoutData ? (
              <p className="text-[13px] text-subtle">Loading…</p>
            ) : (
              dugoutData && (
                <>
                  {/* Section order intentionally leaves room to insert
                      "Watched"/"Favorites" later as further static rows —
                      each section here is independent, so adding one is
                      purely additive, no restructuring needed. */}
                  {DUGOUT_IN_PROGRESS_LABEL[dugoutType] && (
                    <DugoutStaticRow
                      title={DUGOUT_IN_PROGRESS_LABEL[dugoutType]!}
                      items={dugoutData.currentlyWatching}
                      onSelect={handleSelect}
                      emptyText={`Mark a ${dugoutType === "game" ? "game" : "show"} as ${DUGOUT_IN_PROGRESS_LABEL[
                        dugoutType
                      ]!.toLowerCase()} from its detail page.`}
                    />
                  )}
                  <DugoutTileGrid
                    title="On Deck"
                    items={dugoutData.onDeck}
                    onSelect={handleSelect}
                    onAdd={() => setDugoutSearchTarget("onDeck")}
                    emptyText={`Add up to 5 ${DUGOUT_TYPE_NOUN[dugoutType]} you want to ${DUGOUT_TYPE_VERB[dugoutType]} next.`}
                  />
                  <ExpandableWatchlist
                    title={WATCHLIST_LABEL[dugoutType]}
                    items={dugoutData.watchlist}
                    onSelect={handleSelect}
                    onAdd={() => setDugoutSearchTarget("watchlist")}
                  />
                </>
              )
            )}
          </>
        )}

        {view === "notifications" && (
          <>
            <div className="flex items-start justify-between gap-4">
              <PageHeader
                title="Notifications"
                subtitle="Release-day alerts and reminders for what you follow."
              />
              {notifications.length > 0 && (
                <button
                  onClick={handleClearAllNotifications}
                  className="mt-1 shrink-0 text-[13px] font-medium text-subtle transition-colors hover:text-ink"
                >
                  Clear all
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <EmptyState
                icon={<Bell size={22} className="text-subtle" />}
                title="Nothing yet"
                text="When something you follow releases, or a reminder you set is coming up, it shows up here."
              />
            ) : (
              <div>
                {notifications.map((n, i) => {
                  // Live poster/title come from the same freshById overlay
                  // the Home feed already maintains; the frozen message text
                  // is what actually happened, so it never gets rewritten.
                  const live = freshById[n.itemID];
                  const unread = unreadAtOpenRef.current.has(n.id);
                  const isArtist = n.itemID.startsWith("artist:");
                  return (
                    <div
                      key={n.id}
                      className="group flex w-full animate-fade-up items-center gap-4 rounded-xl px-3 py-3.5 transition-colors duration-200 hover:bg-surface/70"
                      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    >
                      <button
                        onClick={() => live && handleSelect(live)}
                        disabled={!live}
                        title={live ? undefined : "No longer available"}
                        className={`flex min-w-0 flex-1 items-center gap-4 text-left ${
                          live ? "" : "cursor-default opacity-50"
                        }`}
                      >
                        {live?.posterURL ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={live.posterURL}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className={`shrink-0 object-cover ${
                              isArtist ? "h-[52px] w-[52px] rounded-full" : "h-[64px] w-[44px] rounded-[8px]"
                            }`}
                          />
                        ) : (
                          <div
                            className={`shrink-0 bg-surface ${
                              isArtist ? "h-[52px] w-[52px] rounded-full" : "h-[64px] w-[44px] rounded-[8px]"
                            }`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[14.5px] font-semibold text-ink">{n.title}</span>
                            {/* eventType is always "reminder" server-side — leadDays is what
                                actually distinguishes "out today" from an advance heads-up. */}
                            {n.leadDays === 0 ? (
                              <span className="shrink-0 rounded-full bg-green-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-green-500">
                                Out now
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-accent">
                                Reminder
                              </span>
                            )}
                          </div>
                          <div className="mt-1 line-clamp-1 text-[13px] text-subtle">{n.message}</div>
                        </div>
                      </button>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-[11.5px] text-subtle">{timeAgo(n.createdAt)}</span>
                        {unread && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                      </div>
                      <button
                        onClick={() => handleClearNotification(n.id)}
                        aria-label="Clear notification"
                        className="shrink-0 rounded-full p-1.5 text-subtle opacity-0 transition-opacity duration-150 hover:text-ink group-hover:opacity-100"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {view === "settings" && (
          <>
            <PageHeader title="Settings" />
            <div className="space-y-4">
              <SettingsRow label="Account">
                <AccountSettings />
              </SettingsRow>
              <SettingsRow label="Appearance">
                <ThemeToggle />
              </SettingsRow>
              <SettingsRow label="Notifications">
                <button
                  onClick={handleTogglePush}
                  className={
                    pushEnabled
                      ? "flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink ring-1 ring-hairline transition-colors hover:bg-panel"
                      : "flex items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-95"
                  }
                >
                  <Bell size={14} />
                  {pushEnabled ? "Disable" : "Enable"}
                </button>
              </SettingsRow>
              {pushError && <p className="-mt-2 px-1 text-[12.5px] text-red-400">{pushError}</p>}
              <p className="-mt-2 px-1 text-[12.5px] text-subtle">
                You&rsquo;ll always be notified the day something you follow releases. The option below adds an
                optional heads-up before that too.
              </p>
              <SettingsRow label="Release reminders">
                {leadTime === null ? (
                  <span className="text-[13px] text-subtle">Enable notifications first</span>
                ) : (
                  <select
                    value={leadTime}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLeadTime(v);
                      void fetchPrefs({ leadTimeDays: v });
                    }}
                    className="input w-44"
                  >
                    {LEAD_TIME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </SettingsRow>
              <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Muted alert types</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    Muted types never push notifications on this device; they still show in your history.
                  </p>
                </div>
                {/* Keyed on push state so enabling push swaps the hint for
                    the live controls without a reload. */}
                <TypeMutes key={String(pushEnabled)} />
              </div>
              <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Calendar sync</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    Subscribe to this URL in Google Calendar, Apple Calendar, or Outlook to see every followed
                    release on your own calendar — updates automatically as you follow new things, no need to
                    re-copy the link.
                  </p>
                </div>
                <CalendarSync />
              </div>
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
                    setDiscoverFetched(false);
                    setSearchResults([]);
                    setHasSearched(false);
                  }}
                />
              </div>
              <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Popular upcoming — international bar</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    How much real anticipation a non-English title needs to appear. English-language titles are unaffected.
                  </p>
                </div>
                <IntlBarSetting
                  onChange={(next) => {
                    setIntlBar(next);
                    setDiscoverData(null);
                    setDiscoverFetched(false);
                  }}
                />
              </div>
              <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
                <div className="mb-3">
                  <span className="text-[15px] font-medium text-ink">Popular upcoming — general bar</span>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    How much real anticipation ANY title needs to appear, regardless of language.
                  </p>
                </div>
                <GeneralBarSetting
                  onChange={(next) => {
                    setGeneralBar(next);
                    setDiscoverData(null);
                    setDiscoverFetched(false);
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
          onClose={() => {
            setSelected(null);
            // A status change made in the modal (self-contained — see
            // DetailModal.tsx) wouldn't otherwise be reflected in the
            // already-fetched Dugout lists until the next navigation.
            if (view === "dugout") refetchDugout();
            // The Continue rail can be affected from ANY view (DetailModal
            // is opened from Discover/Following/Search too, not just
            // Dugout) — always refetch, not gated on `view`.
            refetchContinueWatching();
          }}
        />
      )}

      {dugoutSearchTarget && (
        <DugoutSearchModal
          dugoutType={dugoutType}
          target={dugoutSearchTarget}
          query={dugoutQuery}
          onQueryChange={setDugoutQuery}
          results={dugoutSearchResults}
          searching={dugoutSearching}
          adding={dugoutAdding}
          error={dugoutAddError}
          onSelect={handleDugoutSearchSelect}
          onClose={closeDugoutSearch}
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

// "Currently watching"/"Currently playing" label for a Continue entry —
// deliberately just the bare status, no episode info (see item.subtitle,
// "S{n} E{n}") alongside it.
function continueSubtitle(item: MediaItem): string {
  return item.type === "tvShow" ? "Watching" : "Playing";
}

// Home's right-hand "Continue" rail (desktop only — see the `md:hidden`
// ContinueStrip below for the narrow-viewport equivalent). Deliberately
// quieter than the release feed beside it: no pills, no poster-forward
// cards, just a compact title+status list — the release feed is still the
// point of Home, this is a glance at what's in progress, not a second
// feature competing for the same attention.
function ContinueRail({
  items,
  onSelect,
  onSeeAll,
}: {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  onSeeAll: () => void;
}) {
  return (
    <aside className="hidden md:block md:border-l md:border-hairline/70 md:pl-8">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-subtle">Continue</h2>
      <div className="space-y-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="flex w-full items-center gap-2.5 text-left transition-opacity hover:opacity-80"
          >
            {item.posterURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.posterURL}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-16 w-11 shrink-0 rounded-[7px] object-cover"
              />
            ) : (
              <div className="h-16 w-11 shrink-0 rounded-[7px] bg-surface" />
            )}
            <div className="min-w-0">
              <div className="truncate text-[12.5px] text-ink">{item.title}</div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-subtle">
                <Play size={9} className="shrink-0 fill-accent text-accent" />
                <span className="truncate">{continueSubtitle(item)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={onSeeAll}
        className="mt-4 border-t border-hairline/70 pt-3 text-[11.5px] font-medium text-subtle transition-colors hover:text-ink"
      >
        See Dugout
      </button>
    </aside>
  );
}

// Mobile fallback for the rail above — there's no room for a side column
// below the md breakpoint (same reasoning as Sidebar's own `hidden md:flex`
// desktop-only nav), so this renders as a compact horizontal strip
// underneath the Today spotlight instead, right where the rail would
// otherwise sit relative to the feed.
function ContinueStrip({ items, onSelect }: { items: MediaItem[]; onSelect: (item: MediaItem) => void }) {
  return (
    <div className="md:hidden">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-subtle">Continue</h2>
      <div className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="flex w-40 shrink-0 items-center gap-2.5 rounded-xl bg-surface/70 p-2 text-left"
          >
            {item.posterURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.posterURL}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-16 w-11 shrink-0 rounded-[7px] object-cover"
              />
            ) : (
              <div className="h-16 w-11 shrink-0 rounded-[7px] bg-surface" />
            )}
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-ink">{item.title}</div>
              <div className="mt-1 flex items-center gap-1 text-[10.5px] text-subtle">
                <Play size={9} className="shrink-0 fill-accent text-accent" />
                <span className="truncate">{continueSubtitle(item)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// A fixed, non-scrolling row — used for Dugout's On Deck (capped at 5) and
// Currently Watching (uncapped, but realistically small) sections. Neither
// needs Shelf.tsx's horizontal-scroll/arrow machinery (built for a "browse
// dozens of items" shelf, not a short queue); flex-wrap keeps every item
// visible at once regardless of count, wrapping to a second line rather
// than requiring a scroll gesture.
function DugoutStaticRow({
  title,
  items,
  onSelect,
  emptyText,
}: {
  title: string;
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  emptyText: string;
}) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-[17px] font-bold text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="text-[13px] text-subtle">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {items.map((item, i) => (
            <div key={item.id} className="w-32 shrink-0 sm:w-36">
              <MediaCard item={item} index={i} onSelect={onSelect} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// On Deck's presentation — squarish tiles in one flush grid rather than
// portrait poster cards in a row. Deliberate: On Deck is an UNORDERED set
// capped at 5 (see lib/dugout.ts), and a horizontal row of cards reads as a
// sequence whether or not one is intended (left-to-right implies "first,
// second, third..."). A grid has no built-in reading direction the way a
// row does, so this is the more honest presentation of "5 things, no
// ranking" — confirmed against mockups, see the conversation that chose it.
function DugoutTileGrid({
  title,
  items,
  onSelect,
  onAdd,
  emptyText,
}: {
  title: string;
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  onAdd: () => void;
  emptyText: string;
}) {
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
        <button
          onClick={onAdd}
          aria-label={`Add to ${title}`}
          title={`Add to ${title}`}
          className="flex items-center justify-center text-ink transition-opacity hover:opacity-70"
        >
          <Plus size={18} strokeWidth={2.5} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-subtle">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {items.map((item) => (
            <button key={item.id} onClick={() => onSelect(item)} className="group flex flex-col text-left">
              <div className="relative aspect-square w-full overflow-hidden rounded-xl2 bg-surface ring-1 ring-hairline transition-transform duration-300 group-hover:-translate-y-1">
                {item.posterURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.posterURL} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface text-[11px] text-subtle">
                    No image
                  </div>
                )}
              </div>
              <div className="mt-2">
                <div className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-ink">{item.title}</div>
                {item.releaseDate && (
                  <div className="mt-0.5 text-[10.5px] text-subtle">{new Date(item.releaseDate).getFullYear()}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// Watchlist's "two-row shelf that expands into a page listing the entire
// thing" — self-contained (owns its own expanded/collapsed state) rather
// than hooking into the Discover category/back-button machinery, since all
// of Watchlist's items are already fetched up front (unlike a Discover
// shelf, which only ever fetches a preview slice) — expanding is purely a
// display change, not a new fetch. previewCount picks roughly two rows at
// the most common (4-column) breakpoint; it'll read as a bit more or less
// than two full rows at the 2- and 3-column breakpoints, which isn't worth
// a per-breakpoint calculation for a preview.
function ExpandableWatchlist({
  title,
  items,
  onSelect,
  onAdd,
}: {
  title: string;
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  onAdd: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewCount = 8;

  return (
    <section className="mb-9">
      <div className="mb-3 flex items-center gap-2">
        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            aria-label="Back"
            className="rounded-full p-1 text-subtle transition-colors hover:text-ink"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
        <button
          onClick={onAdd}
          aria-label={`Add to ${title}`}
          title={`Add to ${title}`}
          className="flex items-center justify-center text-ink transition-opacity hover:opacity-70"
        >
          <Plus size={18} strokeWidth={2.5} />
        </button>
        <div className="flex-1" />
        {!expanded && items.length > previewCount && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
          >
            See all
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-subtle">Your {title} is empty.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          {(expanded ? items : items.slice(0, previewCount)).map((item, i) => (
            <MediaCard key={item.id} item={item} index={i} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

// Opened from Dugout's "+" button rather than a permanent search bar sitting
// on the page — same overlay shape as DetailModal (fixed, centered, click-
// outside-to-close) so it reads as part of the same family of popups.
// Selecting a result closes THIS modal and opens DetailModal for it (see the
// onSelect wiring in the main component) — the actual "add to On Deck/
// Watchlist" controls live there, already built; this modal only finds
// things.
// "watchlist" is the one status whose label varies by type (see
// WATCHLIST_LABEL in lib/dugout.ts) — onDeck/currentlyWatching read fine
// as-is across all four types.
function dugoutStatusLabel(status: DugoutStatus, type: DugoutType): string {
  if (status === "watchlist") return WATCHLIST_LABEL[type];
  return status === "onDeck" ? "On Deck" : "Currently Watching";
}

// Unlike every other "select an item" surface in the app (which opens
// DetailModal and leaves the actual add/remove decision to its pills), this
// one adds on click — see handleDugoutSearchSelect. That's why it needs its
// own busy/error handling instead of just handing off to onSelect and
// closing: a click here has a real side effect (and a real failure mode —
// On Deck at its cap) to surface, not just a navigation.
function DugoutSearchModal({
  dugoutType,
  target,
  query,
  onQueryChange,
  results,
  searching,
  adding,
  error,
  onSelect,
  onClose,
}: {
  dugoutType: DugoutType;
  target: DugoutStatus;
  query: string;
  onQueryChange: (q: string) => void;
  results: MediaItem[];
  searching: boolean;
  adding: boolean;
  error: string | null;
  onSelect: (item: MediaItem) => void;
  onClose: () => void;
}) {
  const typeLabel = DUGOUT_TYPE_SEARCH_NOUN[dugoutType];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-30 flex animate-fade-in items-start justify-center bg-black/60 p-4 pt-20 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[70vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-hairline"
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline/70 px-4 pt-3">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-subtle">
            Add to {dugoutStatusLabel(target, dugoutType)}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-subtle transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2.5 border-b border-hairline/70 px-4 py-3">
          <SearchIcon size={18} className="shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={`Search ${typeLabel} to add…`}
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
          />
        </div>
        {error && (
          <p className="border-b border-hairline/70 bg-red-500/10 px-4 py-2 text-[12.5px] text-red-500">{error}</p>
        )}
        <div className={`scrollbar-none flex-1 overflow-y-auto p-4 ${adding ? "pointer-events-none opacity-60" : ""}`}>
          {query.trim().length < MIN_SEARCH_CHARS ? (
            <p className="py-6 text-center text-[13px] text-subtle">
              Start typing to find {typeLabel} to add.
            </p>
          ) : searching ? (
            <p className="py-6 text-center text-[13px] text-subtle">Searching…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-subtle">
              No results for &quot;{query.trim()}&quot;.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4">
              {results.map((item, i) => (
                <MediaCard key={item.id} item={item} index={i} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>
      </div>
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
