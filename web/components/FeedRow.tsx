import type { MediaItem } from "@/lib/types";
import TypeTag from "./TypeTag";

// "Today" gets the loud, gradient-glow treatment — that's the whole point of
// the app. Everything further out is progressively quieter.
function badgeClass(diffDays: number): string {
  if (diffDays === 0)
    return "bg-gradient-to-r from-accent to-accent-2 text-on-accent shadow-md shadow-accent/30";
  if (diffDays < 0) return "bg-surface text-subtle";
  if (diffDays <= 6) return "bg-accent/12 text-accent";
  return "bg-surface text-ink/70";
}

export default function FeedRow({
  item,
  badge,
  onSelect,
  index = 0,
}: {
  item: MediaItem;
  badge?: { label: string; diffDays: number };
  onSelect: (i: MediaItem) => void;
  index?: number;
}) {
  const isToday = badge?.diffDays === 0;

  return (
    <button
      onClick={() => onSelect(item)}
      className="flex w-full animate-fade-up items-center gap-4 rounded-xl2 px-3 py-3 text-left transition-colors duration-200 hover:bg-surface"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      {item.posterURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterURL}
          alt=""
          className="h-20 w-14 shrink-0 rounded-lg object-cover shadow-sm transition-transform duration-300 hover:scale-105"
        />
      ) : (
        <div className="h-20 w-14 shrink-0 rounded-lg bg-gradient-to-br from-surface to-canvas" />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15.5px] font-semibold text-ink">{item.title}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <TypeTag type={item.type} />
          {item.subtitle && <span className="text-[13px] text-subtle">{item.subtitle}</span>}
        </div>
      </div>

      {badge && (
        <span
          className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-all duration-300 ${badgeClass(
            badge.diffDays
          )} ${isToday ? "animate-glow" : ""}`}
        >
          {badge.label}
        </span>
      )}
    </button>
  );
}
