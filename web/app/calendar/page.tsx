"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { addFollow, removeFollow, isFollowed as checkFollowed } from "@/lib/library";
import { syncFollow } from "@/lib/push-client";
import { getHiddenCategories } from "@/lib/hiddenCategories";
import { getIntlBarLevel } from "@/lib/intlBar";
import { getGeneralBarLevel } from "@/lib/generalBar";
import { parseReleaseDay } from "@/lib/feed";
import DetailModal from "@/components/DetailModal";
import MonthCalendarGrid, { dayKey, type CalendarEntry } from "@/components/MonthCalendarGrid";
import { useRequireAuth } from "@/lib/requireAuth";

type TypeFilter = "" | "movie" | "tvShow" | "game";

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tvShow", label: "TV" },
  { value: "game", label: "Games" },
];

export default function CalendarPage() {
  const requireAuth = useRequireAuth();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-indexed
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [, setFollowVersion] = useState(0);

  useEffect(() => {
    setLoading(true);
    const hidden = getHiddenCategories();
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      intlBar: getIntlBarLevel(),
      generalBar: getGeneralBarLevel(),
    });
    if (typeFilter) params.set("types", typeFilter);
    if (hidden.length > 0) params.set("hide", hidden.join(","));
    fetch(`/api/calendar?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: MediaItem[]) => setItems(rows))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [year, month, typeFilter]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const item of items) {
      if (!item.releaseDate) continue;
      const key = dayKey(parseReleaseDay(item.releaseDate));
      const entry: CalendarEntry = {
        key: item.id,
        title: item.title,
        type: item.type,
        posterURL: item.posterURL,
        onSelect: () => setSelected(item),
      };
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [items]);

  const selectedFollowed = selected ? checkFollowed(selected.id) : false;

  function goToMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  return (
    <div className="relative bg-canvas">
      {/* h-dvh + border-box (Tailwind's preflight default) means the px/py
          padding below is INSIDE that height, not added on top — so the
          flex column's content box is exactly "viewport minus padding," and
          the flex-1 grid area gets whatever's left after the fixed-height
          header/filter rows above it. That's what makes the month grid fit
          the screen without a page scroll, instead of the day-cells' fixed
          min-height forcing the whole page taller than the viewport. */}
      <main className="relative mx-auto flex h-dvh max-w-7xl flex-col px-6 py-12 md:px-12">
        <div className="mb-7 flex items-center justify-between">
          <div>
            <Link
              href="/"
              className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-subtle transition-colors hover:text-ink"
            >
              <ArrowLeft size={14} />
              Back
            </Link>
            <h1 className="text-[28px] font-bold tracking-tight text-ink">Calendar</h1>
            <p className="mt-1 text-[14px] text-subtle">Every upcoming release, laid out by month.</p>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {TYPE_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                typeFilter === value ? "bg-accent text-on-accent" : "bg-surface text-subtle hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1">
          <MonthCalendarGrid
            year={year}
            month={month}
            onMonthChange={goToMonth}
            onToday={() => {
              setYear(today.getFullYear());
              setMonth(today.getMonth() + 1);
            }}
            entriesByDay={entriesByDay}
            loading={loading}
            emptyMessage={`Nothing found for this month.`}
          />
        </div>
      </main>

      {selected && (
        <DetailModal
          item={selected}
          isFollowed={selectedFollowed}
          onFollow={(full) => {
            if (!requireAuth()) return;
            addFollow(full);
            void syncFollow(full.id, true);
            setFollowVersion((v) => v + 1);
          }}
          onUnfollow={() => {
            if (!requireAuth()) return;
            removeFollow(selected.id);
            void syncFollow(selected.id, false);
            setFollowVersion((v) => v + 1);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
