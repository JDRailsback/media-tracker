import { NextResponse } from "next/server";
import { discoverCached, discoverCategory } from "@/lib/sources";
import { getUpcomingCalendarPage, getNewReleasesCalendarPage } from "@/lib/upcomingCalendar";
import { parseHiddenCategories } from "@/lib/contentFilters";
import { DEFAULT_INTL_BAR_LEVEL, type IntlBarLevel } from "@/lib/intlBar";
import { DEFAULT_GENERAL_BAR_LEVEL, type GeneralBarLevel } from "@/lib/generalBar";

function parseIntlBar(param: string | null): IntlBarLevel {
  return param === "off" || param === "moderate" || param === "strict" ? param : DEFAULT_INTL_BAR_LEVEL;
}

function parseGeneralBar(param: string | null): GeneralBarLevel {
  return param === "off" || param === "moderate" || param === "strict" ? param : DEFAULT_GENERAL_BAR_LEVEL;
}

// Dynamic today because it reads request.url, but explicit so a refactor
// can't silently turn it into a statically-cached route (see /api/item).
export const dynamic = "force-dynamic";

// "upcoming" and "new-releases" are the two categories that paginate — both
// meant to be browsed hundreds deep (real release calendars, precomputed
// daily — see lib/upcomingCalendar.ts), unlike the other categories' single
// fixed-size grid (discoverCategory below). `page` is a page NUMBER
// (0, 1, 2, ...), not an item offset — both paginated reads always request
// a fixed pageSize per page, so paging by item count would drift if a page
// ever came back short. "new-releases" walks newest-first (release_date
// DESC) instead of "upcoming"'s soonest-first, but is otherwise identical —
// same admission rules, same bar thresholds, since new_releases_calendar's
// rows are literally upcoming_calendar's graduates (see
// lib/upcomingCalendar.ts's graduateReleasedTitles) — the two can never
// overlap.
// GET /api/discover                              -> DiscoverPayload (trending shelves + popularUpcoming, newReleases, featuredCollections)
// GET /api/discover?category=movies              -> MediaItem[] (expanded single category)
// GET /api/discover?category=upcoming&page=1     -> MediaItem[] (paginated; response carries X-Has-More)
// GET /api/discover?category=new-releases&page=1 -> MediaItem[] (paginated, newest first; response carries X-Has-More)
// &hide=manga,anime,asian-drama,indie-games   -> Settings' Content filters selection, applied to any form above
// &intlBar=off|moderate|strict                -> Settings' international anticipation bar (see lib/intlBar.ts), applies to upcoming/new-releases only
// &generalBar=off|moderate|strict              -> Settings' general anticipation bar (see lib/generalBar.ts), same scope as intlBar but language-independent
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const hidden = parseHiddenCategories(searchParams.get("hide"));
  const intlBar = parseIntlBar(searchParams.get("intlBar"));
  const generalBar = parseGeneralBar(searchParams.get("generalBar"));

  // Discover only changes once a day (the cron refresh), so the edge can
  // serve repeat requests for a while without touching the DB at all — same
  // reasoning and values as /api/search's headers.
  const headers: Record<string, string> = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" };

  try {
    if (category === "upcoming" || category === "new-releases") {
      const page = Math.max(0, Number(searchParams.get("page")) || 0);
      const pager = category === "upcoming" ? getUpcomingCalendarPage : getNewReleasesCalendarPage;
      const { items, hasMore } = await pager(["movie", "tvShow", "game"], hidden, page, undefined, intlBar, generalBar);
      return NextResponse.json(items, { headers: { ...headers, "X-Has-More": String(hasMore) } });
    }
    if (category) {
      return NextResponse.json(await discoverCategory(category, hidden), { headers });
    }
    return NextResponse.json(await discoverCached(hidden, intlBar, generalBar), { headers });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Discover failed" }, { status: 502 });
  }
}
