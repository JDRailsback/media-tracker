// The user's "international anticipation bar" (Settings → "Popular upcoming")
// — personal, per-device preference, same storage pattern as
// lib/hiddenCategories.ts. Trakt's anticipated lists (see lib/trakt.ts) are
// a real signal, but they skew toward Trakt's own English-speaking user
// base: a non-English title with real anticipation in its own market (e.g.
// a Tamil or Cantonese blockbuster) still registers a much lower list_count
// than an equally-anticipated English-language one — verified live (Jana
// Nayagan and Ip Man: Kung Fu Legend, both real regional hits, scored
// 276/300 against Avengers: Doomsday's 56,209). This setting raises the
// admission bar for non-English titles specifically, WITHOUT touching the
// bar for English-language titles — see lib/upcomingCalendar.ts's
// intlBarSQL for where the actual thresholds live.
export type IntlBarLevel = "off" | "moderate" | "strict";

export const INTL_BAR_LEVELS: { key: IntlBarLevel; label: string; description: string }[] = [
  { key: "off", label: "Off", description: "Treat every language the same — any Trakt-anticipated title can appear." },
  {
    key: "moderate",
    label: "Moderate",
    description: "Non-English titles need noticeably more real anticipation to appear.",
  },
  {
    key: "strict",
    label: "Strict",
    description: "Only major international crossover hits appear (e.g. Godzilla Minus One-level).",
  },
];

const KEY = "intlBarLevel";
export const DEFAULT_INTL_BAR_LEVEL: IntlBarLevel = "moderate";

export function getIntlBarLevel(): IntlBarLevel {
  if (typeof window === "undefined") return DEFAULT_INTL_BAR_LEVEL;
  const v = localStorage.getItem(KEY);
  return v === "off" || v === "moderate" || v === "strict" ? v : DEFAULT_INTL_BAR_LEVEL;
}

export function setIntlBarLevel(level: IntlBarLevel): void {
  localStorage.setItem(KEY, level);
}
