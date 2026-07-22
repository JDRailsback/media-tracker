// The user's general "Popular upcoming" quality bar (Settings) — same
// storage pattern as lib/intlBar.ts, but applies to EVERY movie/brand-new-TV
// title regardless of language (lib/intlBar.ts's bar only raises the floor
// for non-English titles). Explicit request: even English-language titles
// that clear Trakt's admission (real anticipation exists) can still feel
// like noise if that anticipation is modest — verified live that Pinocchio:
// Unstrung (rank_score 1725), A Toxic Love Story (262), and Bad Counselors
// (137) all cleared Trakt's own bar but read as "slop" next to genuine
// tentpoles. This setting raises the floor for ALL of them, independent of
// language — see lib/upcomingCalendar.ts's generalBarSQL for the thresholds.
export type GeneralBarLevel = "off" | "moderate" | "strict";

export const GENERAL_BAR_LEVELS: { key: GeneralBarLevel; label: string; description: string }[] = [
  { key: "off", label: "Off", description: "Any Trakt-anticipated / AAA-hyped title can appear, regardless of how modest." },
  {
    key: "moderate",
    label: "Moderate",
    description: "Needs noticeably more real anticipation than Trakt's own bar alone — cuts modest-buzz titles.",
  },
  {
    key: "strict",
    label: "Strict",
    description: "Only genuine tentpole-scale titles appear — expect real gaps on quiet days.",
  },
];

const KEY = "generalBarLevel";
export const DEFAULT_GENERAL_BAR_LEVEL: GeneralBarLevel = "moderate";

export function getGeneralBarLevel(): GeneralBarLevel {
  if (typeof window === "undefined") return DEFAULT_GENERAL_BAR_LEVEL;
  const v = localStorage.getItem(KEY);
  return v === "off" || v === "moderate" || v === "strict" ? v : DEFAULT_GENERAL_BAR_LEVEL;
}

export function setGeneralBarLevel(level: GeneralBarLevel): void {
  localStorage.setItem(KEY, level);
}
