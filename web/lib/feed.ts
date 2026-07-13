import type { FollowedItem } from "./library";

// Turns followed items into a "what's happening" feed: human phrases like
// "New episode Friday", "Releases today", "Released yesterday". This is the
// app's core value prop — not activity tracking, just "am I up to date".

function daysBetween(date: Date, base: Date): number {
  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const d2 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((d1.getTime() - d2.getTime()) / 86_400_000);
}

function relativeDay(date: Date, now: Date): string {
  const diff = daysBetween(date, now);
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff <= 6) return date.toLocaleDateString(undefined, { weekday: "long" });
  if (diff < -1 && diff >= -6) return `last ${date.toLocaleDateString(undefined, { weekday: "long" })}`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

const VERBS: Record<string, { future: string; today: string; past: string }> = {
  movie: { future: "Releases", today: "Releases today", past: "Released" },
  game: { future: "Releases", today: "Releases today", past: "Released" },
  tvShow: { future: "New episode", today: "New episode out today", past: "New episode" },
  manga: { future: "New chapter", today: "New chapter out today", past: "New chapter" },
};

export interface ReleaseInfo {
  label: string;
  // The label split into its two halves ("New episode" / "Saturday") so the
  // UI can typeset them as separate lines — FeedRow renders verb as a small
  // overline and `when` as the strong line. Empty `when` for today (the
  // whole label is the moment: "Releases today").
  verb: string;
  when: string;
  diffDays: number; // negative = past, 0 = today, positive = future
}

export function describeRelease(item: FollowedItem, now: Date = new Date()): ReleaseInfo | null {
  if (!item.releaseDate) return null;
  const date = new Date(item.releaseDate);
  if (Number.isNaN(date.getTime())) return null;

  const diffDays = daysBetween(date, now);
  const verb = VERBS[item.type] ?? VERBS.movie;

  if (diffDays === 0) {
    return { label: verb.today, verb: verb.today, when: "", diffDays };
  }
  const v = diffDays > 0 ? verb.future : verb.past;
  const when = relativeDay(date, now);
  return { label: `${v} ${when}`, verb: v, when, diffDays };
}

export interface FeedGroup {
  key: string;
  title: string;
  items: FollowedItem[];
}

// Only surface recent-past releases (last 2 weeks) — older ones aren't "news"
// anymore, they just sit in the Library. A followed item with no known date
// at all (never released a next-episode signal, or an old release outside
// this window) simply doesn't appear on Home — there's nothing new to
// report. That's correct, not a bug: for most TV shows, "no known next
// episode" is the normal state between seasons (TMDB itself frequently has
// no next_episode_to_air for a show on hiatus — verified live against real
// shows, not a gap in what we extract from it), and an old movie/game has
// nothing new happening either. The full list, regardless of dates, is
// always in Following.
const PAST_WINDOW_DAYS = 14;

export function buildFeed(followed: FollowedItem[], now: Date = new Date()): FeedGroup[] {
  const dated = followed
    .map((item) => ({ item, info: describeRelease(item, now) }))
    .filter((x): x is { item: FollowedItem; info: ReleaseInfo } => x.info !== null)
    .filter((x) => x.info.diffDays >= -PAST_WINDOW_DAYS);
  dated.sort((a, b) => a.info.diffDays - b.info.diffDays);

  const groups: FeedGroup[] = [
    { key: "past", title: "Recently released", items: [] },
    { key: "today", title: "Today", items: [] },
    { key: "week", title: "This week", items: [] },
    { key: "month", title: "This month", items: [] },
    { key: "later", title: "Later", items: [] },
  ];

  for (const { item, info } of dated) {
    if (info.diffDays < 0) groups[0].items.push(item);
    else if (info.diffDays === 0) groups[1].items.push(item);
    else if (info.diffDays <= 6) groups[2].items.push(item);
    else if (info.diffDays <= 30) groups[3].items.push(item);
    else groups[4].items.push(item);
  }

  return groups.filter((g) => g.items.length > 0);
}
