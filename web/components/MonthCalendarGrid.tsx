"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MediaType } from "@/lib/types";

// Shared by app/calendar (every upcoming release) and the sidebar's
// followed-items calendar view in app/page.tsx — same month-grid chrome,
// different data behind it (a flat MediaItem per day vs. a followed TV
// show expanded into one entry per remaining episode). Each consumer maps
// its own data into these generic entries; this component only knows how
// to lay a month out and expand/collapse a day.
export interface CalendarEntry {
  // Unique across the WHOLE month's entries, not just within a day — an
  // episode's own id (`${showId}:s${season}e${episode}`) rather than the
  // show's id, since one show can contribute many entries to one month.
  key: string;
  title: string;
  subtitle?: string;
  posterURL?: string;
  type: MediaType;
  onSelect: () => void;
}

// Same three colors as TypeTag, as flat dots — used in the side panel next
// to each entry's type label.
const TYPE_DOT: Record<string, string> = {
  movie: "bg-blue-500",
  tvShow: "bg-violet-500",
  game: "bg-emerald-500",
  artist: "bg-cyan-500",
};

// Same palette as TypeTag's badges (see components/TypeTag.tsx) — reused
// here as day-cell chip backgrounds so a title reads as "this kind of
// thing" via the exact same color the user already associates with that
// type everywhere else in the app, not a new mapping to relearn.
const TYPE_CHIP: Record<string, string> = {
  movie: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  tvShow: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  game: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  artist: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
};

const TYPE_LABEL: Partial<Record<MediaType, string>> = {
  movie: "Movie",
  tvShow: "TV",
  game: "Game",
  artist: "Music",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Monday-first grid, matching the rest of the app's week convention (see
// lib/feed.ts's startOfWeek) — leading/trailing cells from adjacent months
// are included (grayed out) so every week row is a full 7 columns.
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month - 1, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0=Mon .. 6=Sun
  const gridStart = new Date(year, month - 1, 1 - firstWeekday);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  // Trim trailing all-outside-month row(s) so a 4-or-5-week month doesn't
  // always pad to a visually-empty 6th row.
  while (days.length > 35 && days.slice(-7).every((d) => d.getMonth() !== month - 1)) {
    days.splice(-7, 7);
  }
  return days;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MonthCalendarGrid({
  year,
  month,
  onMonthChange,
  onToday,
  entriesByDay,
  loading = false,
  emptyMessage,
}: {
  year: number;
  month: number; // 1-indexed
  onMonthChange: (delta: -1 | 1) => void;
  onToday: () => void;
  entriesByDay: Map<string, CalendarEntry[]>;
  loading?: boolean;
  emptyMessage?: string;
}) {
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  // Covers both month navigation (year/month change synchronously with the
  // click, before any new data arrives) and a filter change re-deriving
  // entriesByDay with the same year/month — either way, a day selected
  // under the PREVIOUS data shouldn't stay expanded showing stale/mismatched
  // items.
  useEffect(() => {
    setSelectedDayKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, entriesByDay]);

  const today = new Date();
  const todayKey = dayKey(today);
  const grid = buildMonthGrid(year, month);
  const selectedDayItems = selectedDayKey ? entriesByDay.get(selectedDayKey) ?? [] : [];
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  // Checked against the DISPLAYED month's own days, not entriesByDay.size —
  // a consumer that hands over one flat map spanning many months (the
  // followed-items calendar, which fetches once and paginates entirely
  // client-side) would otherwise never show "nothing this month" for an
  // actually-empty month as long as SOME other month had entries.
  const isEmpty =
    !loading && grid.every((d) => d.getMonth() !== month - 1 || (entriesByDay.get(dayKey(d)) ?? []).length === 0);
  // Rows come out to 5 or 6 depending on the month/weekday alignment — used
  // to size grid rows as an even 1fr split of whatever height the flex-1
  // wrapper below actually has, instead of a fixed per-cell height. That's
  // what lets the grid fit inside a bounded-height page (see the h-dvh
  // wrappers in app/calendar/page.tsx and app/page.tsx's "calendar" view)
  // without forcing a page scroll — a 6-week month's rows just end up a
  // little shorter than a 5-week month's, not off the bottom of the screen.
  const weekRows = Math.ceil(grid.length / 7);

  return (
    <div className="flex h-full flex-col gap-8 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-5 flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onMonthChange(-1)}
              aria-label="Previous month"
              className="rounded-full p-1.5 text-subtle transition-colors hover:bg-surface hover:text-ink"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="min-w-[160px] text-center text-[16px] font-semibold text-ink">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={() => onMonthChange(1)}
              aria-label="Next month"
              className="rounded-full p-1.5 text-subtle transition-colors hover:bg-surface hover:text-ink"
            >
              <ChevronRight size={20} />
            </button>
          </div>
          {!isCurrentMonth && (
            <button
              onClick={onToday}
              className="text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
            >
              Today
            </button>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-7 gap-1 text-center text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="pb-2">
              {d}
            </div>
          ))}
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className={`grid h-full grid-cols-7 gap-1 ${loading ? "opacity-50" : ""}`}
            style={{ gridTemplateRows: `repeat(${weekRows}, minmax(0, 1fr))` }}
          >
            {/* Each cell button below needs its own min-h-0 (not just the
                track's minmax(0, 1fr)) — a grid ITEM's default implicit
                min-height is auto (= its content's natural size), which
                can force the row taller than the track asked for and bleed
                into the row below. Confirmed live: without it, a busy day's
                two chips pushed its row past the next row's date number. */}
            {grid.map((d) => {
              const key = dayKey(d);
              const inMonth = d.getMonth() === month - 1;
              const dayItems = entriesByDay.get(key) ?? [];
              const isToday = key === todayKey;
              const isSelected = key === selectedDayKey;
              const visible = dayItems.slice(0, 2);
              const overflow = dayItems.length - visible.length;
              return (
                <button
                  key={key}
                  onClick={() => dayItems.length > 0 && setSelectedDayKey(isSelected ? null : key)}
                  disabled={dayItems.length === 0}
                  className={`flex min-h-0 flex-col items-start gap-1 overflow-hidden rounded-lg p-1.5 text-left transition-colors duration-150 ${
                    isSelected ? "bg-accent/15 ring-1 ring-accent/40" : dayItems.length > 0 ? "hover:bg-surface" : ""
                  } ${!inMonth ? "opacity-35" : ""}`}
                >
                  <span
                    className={`shrink-0 text-[12px] ${
                      isToday
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent font-bold text-on-accent"
                        : "font-medium text-ink"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {dayItems.length > 0 && (
                    // overflow-hidden here clips whole lines cleanly off the
                    // bottom when a short row doesn't have room for all of
                    // them. Each line below needs shrink-0 or flexbox does
                    // the opposite: it compresses every line's box height
                    // instead of dropping whichever one doesn't fit,
                    // squashing the text into an illegible, overlapping-
                    // looking smear — confirmed live, a chip's own line
                    // rendered at 4px tall instead of its ~14px content
                    // height once the cell got tight.
                    <div className="flex w-full min-h-0 flex-col gap-0.5 overflow-hidden">
                      {visible.map((it) => (
                        <span
                          key={it.key}
                          className={`shrink-0 truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${
                            TYPE_CHIP[it.type] ?? "bg-surface text-subtle"
                          }`}
                        >
                          {/* Prefer subtitle when present — a followed show's
                              episode entry sets it to "Show — S1 E2" (see
                              app/page.tsx), which is identifiable at a glance;
                              the bare episode title ("Memory") alone isn't. */}
                          {it.subtitle ?? it.title}
                        </span>
                      ))}
                      {overflow > 0 && (
                        <span className="shrink-0 px-1 text-[9.5px] font-semibold text-subtle">
                          +{overflow} more
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {isEmpty && emptyMessage && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[13.5px] text-subtle">
              {emptyMessage}
            </p>
          )}
        </div>
      </div>

      {/* Side panel on wide screens (fills the space beside the grid a
          fixed-width column would otherwise waste), stacks below it on
          narrow ones — a two-column calendar+detail layout doesn't have
          room to sit side by side under ~1024px (lg). lg:overflow-y-auto
          scrolls WITHIN the panel on a busy day instead of growing past the
          grid's height and reintroducing a page scroll. */}
      <div className="rounded-xl bg-surface p-4 lg:h-full lg:w-[280px] lg:shrink-0 lg:overflow-y-auto">
        {selectedDayKey && selectedDayItems.length > 0 ? (
          <div className="animate-fade-up">
            <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-subtle">
              {new Date(
                Number(selectedDayKey.slice(0, 4)),
                Number(selectedDayKey.slice(5, 7)) - 1,
                Number(selectedDayKey.slice(8, 10))
              ).toLocaleDateString(undefined, { weekday: "long" })}
            </div>
            <h2 className="mb-4 text-[17px] font-bold text-ink">
              {new Date(
                Number(selectedDayKey.slice(0, 4)),
                Number(selectedDayKey.slice(5, 7)) - 1,
                Number(selectedDayKey.slice(8, 10))
              ).toLocaleDateString(undefined, { month: "long", day: "numeric" })}
            </h2>
            <div className="space-y-2.5">
              {selectedDayItems.map((entry) => (
                <button
                  key={entry.key}
                  onClick={entry.onSelect}
                  className="flex w-full items-center gap-3 rounded-lg text-left transition-opacity hover:opacity-80"
                >
                  {entry.posterURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.posterURL}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      // Same size as the Notifications row's thumbnail (see
                      // app/page.tsx) — this panel's earlier 34x48 was the
                      // smallest poster box anywhere in the app, small enough
                      // that object-cover's ordinary crop read as posters
                      // being cut off, especially next to a long, wrapping
                      // subtitle.
                      className="h-[64px] w-[44px] shrink-0 rounded-[8px] object-cover"
                    />
                  ) : (
                    <div className="h-[64px] w-[44px] shrink-0 rounded-[8px] bg-panel" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{entry.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-subtle">
                      <span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT[entry.type] ?? "bg-subtle"}`} />
                      {entry.subtitle ?? TYPE_LABEL[entry.type] ?? entry.type}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          !isEmpty && (
            <p className="hidden text-[13.5px] text-subtle lg:block">Select a day to see what&rsquo;s releasing.</p>
          )
        )}
      </div>
    </div>
  );
}
