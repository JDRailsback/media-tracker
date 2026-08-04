import type { FollowedItem } from "./library";

// Turns followed items into a "what's happening" feed: human phrases like
// "New episode Friday", "Releases today", "Released yesterday". This is the
// app's core value prop — not activity tracking, just "am I up to date".

// Exported for /api/poll's reminder trigger — the lead-time match must use
// the exact same calendar-day math the feed uses, or a reminder could fire
// on a different day than the badge it corresponds to.
export function daysBetween(date: Date, base: Date): number {
  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const d2 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((d1.getTime() - d2.getTime()) / 86_400_000);
}

// Monday-start week boundary — everything that reasons about "week" in this
// file means the Mon-Sun sense most calendars use, not a rolling 7-day
// window from today. `d` is assumed to already be truncated to a local
// calendar day.
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const result = new Date(d);
  result.setDate(result.getDate() + diffToMonday);
  return result;
}

// The exclusive end of "next week" (the Monday after next) — shared by
// relativeDay below and buildFeed's own bucketing, so a date's LABEL
// ("Friday") and the GROUP it lands in ("Next week") always agree. These
// used to drift: relativeDay switched to a weekday name only within a
// rolling "diff <= 6" window, while buildFeed's bucket followed a full
// calendar next-week — verified live, an item 8 days out (in the "Next
// week" group) still showed a bare "Jul 31" instead of "Friday" because it
// had fallen outside that old 6-day window. One function for both closes
// that gap for good instead of just widening the magic number.
function endOfNextWeek(now: Date): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const result = startOfWeek(today);
  result.setDate(result.getDate() + 14);
  return result;
}

function relativeDay(date: Date, now: Date): string {
  const diff = daysBetween(date, now);
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && date < endOfNextWeek(now)) return date.toLocaleDateString(undefined, { weekday: "long" });
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
  // Generic on purpose — the artist's subtitle carries the specific kind
  // ("Single — Title", see catalogRowToMediaItem's artist branch).
  artist: { future: "New release", today: "New release out today", past: "New release" },
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
  // Formatted local time ("9:00 PM"), present ONLY when an exact release
  // instant is known — currently TV episodes with a TVmaze airstamp
  // attached (see lib/airtimes.ts). Absent for every other media type,
  // which keeps their day-precision display exactly as it always was.
  time?: string;
}

// Exported for DetailModal's episode list, which formats each row's date
// independently of describeRelease (it's not "the next release," just a
// row in a list) but wants the identical time format when an airStamp
// is present.
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Release dates in this app are DAY-precision everywhere (DATE columns; a
// title's airtime-of-day is never meaningful), but they arrive as ISO
// strings that JS parses as UTC midnight — which is the PREVIOUS day in any
// western timezone. Verified live: an episode airing "today" (2026-07-14)
// badged as "yesterday". Parse the Y-M-D prefix as a LOCAL date instead.
export function parseReleaseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(s);
}

export function describeRelease(item: FollowedItem, now: Date = new Date()): ReleaseInfo | null {
  if (!item.releaseDate) return null;
  // An exact instant (releaseAt) is authoritative for BOTH which calendar
  // day this lands on locally and the time shown. This is a different case
  // from parseReleaseDay's guard below: that guard exists because a
  // DATE-ONLY string ("2026-07-14", no time) gets misread as UTC midnight
  // by plain `new Date()`, which is one calendar day early in western
  // timezones. A real timestamp carries its own timezone information, so
  // letting JS's Date correctly localize it is exactly right, not the bug
  // parseReleaseDay works around.
  const date = item.releaseAt ? new Date(item.releaseAt) : parseReleaseDay(item.releaseDate);
  if (Number.isNaN(date.getTime())) return null;

  const time = item.releaseAt ? formatTime(date) : undefined;
  const diffDays = daysBetween(date, now);
  const verb = VERBS[item.type] ?? VERBS.movie;

  if (diffDays === 0) {
    if (time) {
      // "New episode" rather than "...out today" — the time already says
      // "today", spelling it out twice reads redundant.
      return { label: `${verb.future} · ${time}`, verb: verb.future, when: time, diffDays, time };
    }
    return { label: verb.today, verb: verb.today, when: "", diffDays };
  }
  const v = diffDays > 0 ? verb.future : verb.past;
  const whenDay = relativeDay(date, now);
  const when = time ? `${whenDay}, ${time}` : whenDay;
  return { label: `${v} ${when}`, verb: v, when, diffDays, time };
}

export interface FeedGroup {
  key: string;
  title: string;
  items: FollowedItem[];
}

// Upcoming only — Home is "what's coming," not an activity log, so a past
// release never appears here regardless of how recent. A followed item with
// no known upcoming date at all (never released a next-episode signal, or
// its only known release is behind it) simply doesn't appear on Home —
// there's nothing new to report. That's correct, not a bug: for most TV
// shows, "no known next episode" is the normal state between seasons (TMDB
// itself frequently has no next_episode_to_air for a show on hiatus —
// verified live against real shows, not a gap in what we extract from it),
// and an old movie/game/album has nothing new happening either. The full
// list, regardless of dates, is always in Following.
//
// "Today" entries are deliberately NOT bucketed here — the Home page pulls
// every today release out into its own hero treatment (see app/page.tsx)
// before calling this, so by the time this runs there's normally nothing
// left at diffDays === 0.
//
// Buckets are calendar-aligned, not rolling windows: "This week"/"Next week"
// are real Monday-Sunday weeks (so a release on Saturday reads as "this
// week" even though it's only 2 days out, and a release next Monday reads
// as "next week" even though it's only 3 days out) — explicit request, since
// a rolling "next 7 days" window doesn't match how people actually think
// about "this week" vs "next week". Beyond that, buckets are real calendar
// months ("August", "September", ...) rather than a single catch-all
// "Later" — groups are created lazily in the (already date-sorted) order
// items are visited, so they naturally come out chronological with no
// separate sort needed, and an empty bucket never gets created at all.
export function buildFeed(followed: FollowedItem[], now: Date = new Date()): FeedGroup[] {
  const dated = followed
    .map((item) => ({ item, info: describeRelease(item, now) }))
    .filter((x): x is { item: FollowedItem; info: ReleaseInfo } => x.info !== null)
    .filter((x) => x.info.diffDays >= 0);
  dated.sort((a, b) => {
    if (a.info.diffDays !== b.info.diffDays) return a.info.diffDays - b.info.diffDays;
    // Same day: items with no exact time (movies/games — just "Friday")
    // come first, then timed items (TV episodes with a known airtime) in
    // chronological order. Without this, same-day items only kept
    // whatever order they happened to be followed in.
    const aAt = a.item.releaseAt;
    const bAt = b.item.releaseAt;
    if (!aAt && !bAt) return 0;
    if (!aAt) return -1;
    if (!bAt) return 1;
    return new Date(aAt).getTime() - new Date(bAt).getTime();
  });

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const afterNextWeekStart = endOfNextWeek(now);
  const nextWeekStart = new Date(afterNextWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() - 7);

  function bucketFor(date: Date): { key: string; title: string } {
    if (date < afterNextWeekStart) {
      return date < nextWeekStart ? { key: "this-week", title: "This week" } : { key: "next-week", title: "Next week" };
    }
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      title: date.toLocaleDateString(undefined, {
        month: "long",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      }),
    };
  }

  const groups: FeedGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const { item, info } of dated) {
    const date = new Date(today);
    date.setDate(date.getDate() + info.diffDays);
    const { key, title } = bucketFor(date);
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groups.push({ key, title, items: [] });
      indexByKey.set(key, idx);
    }
    groups[idx].items.push(item);
  }

  return groups;
}
