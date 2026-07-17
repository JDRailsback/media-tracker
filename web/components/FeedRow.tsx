import type { MediaItem } from "@/lib/types";
import TypeTag from "./TypeTag";

// A row in the Home/Following schedule. Nocturne: rows sit in open space —
// no card container, no dividers — separated by breathing room alone, with
// a soft rounded hover as the only surface. The right side is the date
// "leaf": verb as a small overline, day as the strong line. Today gets a
// pale moonlight badge (accent bg + near-black text in dark mode) — solid
// and calm, never glowing.
export default function FeedRow({
  item,
  badge,
  onSelect,
  index = 0,
}: {
  item: MediaItem;
  badge?: { label: string; verb?: string; when?: string; diffDays: number };
  onSelect: (i: MediaItem) => void;
  index?: number;
}) {
  const isToday = badge?.diffDays === 0;
  const isPast = (badge?.diffDays ?? 0) < 0;
  const isSoon = !isToday && !isPast && (badge?.diffDays ?? 99) <= 6;

  return (
    <button
      onClick={() => onSelect(item)}
      className="flex w-full animate-fade-up items-center gap-5 rounded-xl px-3 py-4 text-left transition-colors duration-200 hover:bg-surface/70"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      {/* Artists get a round portrait (a person, not a poster) — everything
          else keeps the 2:3 poster thumbnail. */}
      {item.posterURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterURL}
          alt=""
          className={`shrink-0 object-cover ${
            item.type === "artist" ? "h-[72px] w-[72px] rounded-full" : "h-[92px] w-[64px] rounded-[10px]"
          }`}
        />
      ) : (
        <div
          className={`shrink-0 bg-surface ${
            item.type === "artist" ? "h-[72px] w-[72px] rounded-full" : "h-[92px] w-[64px] rounded-[10px]"
          }`}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[16.5px] font-semibold text-ink">{item.title}</div>
        <div className="mt-2 flex items-center gap-2">
          <TypeTag type={item.type} />
          {item.subtitle && <span className="text-[13px] text-subtle">{item.subtitle}</span>}
        </div>
      </div>

      {badge &&
        (isToday ? (
          <span className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-bold text-on-accent">
            {badge.label}
          </span>
        ) : (
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle/80">
              {badge.verb ?? ""}
            </div>
            <div
              className={`mt-0.5 text-[13.5px] font-semibold ${
                isSoon ? "text-accent" : isPast ? "text-subtle" : "text-ink/70"
              }`}
            >
              {badge.when ?? badge.label}
            </div>
          </div>
        ))}
    </button>
  );
}
