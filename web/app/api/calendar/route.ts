import { NextResponse } from "next/server";
import { getUpcomingCalendarMonth } from "@/lib/upcomingCalendar";
import { parseHiddenCategories } from "@/lib/contentFilters";
import { DEFAULT_INTL_BAR_LEVEL, type IntlBarLevel } from "@/lib/intlBar";
import { DEFAULT_GENERAL_BAR_LEVEL, type GeneralBarLevel } from "@/lib/generalBar";

const ALL_TYPES = ["movie", "tvShow", "game"];

function parseIntlBar(param: string | null): IntlBarLevel {
  return param === "off" || param === "moderate" || param === "strict" ? param : DEFAULT_INTL_BAR_LEVEL;
}

function parseGeneralBar(param: string | null): GeneralBarLevel {
  return param === "off" || param === "moderate" || param === "strict" ? param : DEFAULT_GENERAL_BAR_LEVEL;
}

// Dynamic today because it reads request.url, same reasoning as /api/discover.
export const dynamic = "force-dynamic";

// GET /api/calendar?year=2026&month=7[&types=movie,tvShow,game][&hide=...][&intlBar=][&generalBar=]
// -> MediaItem[] for that single calendar month, feeding the /calendar
// month-grid page. Same admission/bar rules as Discover's "Popular
// upcoming" — see lib/upcomingCalendar.ts's getUpcomingCalendarMonth.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month (1-12) required" }, { status: 400 });
  }

  const typesParam = searchParams.get("types");
  const types = typesParam
    ? typesParam.split(",").filter((t) => ALL_TYPES.includes(t))
    : ALL_TYPES;

  const hidden = parseHiddenCategories(searchParams.get("hide"));
  const intlBar = parseIntlBar(searchParams.get("intlBar"));
  const generalBar = parseGeneralBar(searchParams.get("generalBar"));

  try {
    const items = await getUpcomingCalendarMonth(
      types.length > 0 ? types : ALL_TYPES,
      year,
      month,
      hidden,
      intlBar,
      generalBar
    );
    return NextResponse.json(items);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Calendar fetch failed" }, { status: 502 });
  }
}
