import type { MediaItem } from "@/lib/types";
import TypeTag from "./TypeTag";

// A row in the Home/Following schedule list. Rows are designed to sit
// inside a divide-y container (see page.tsx), so they carry no rounding or
// border of their own — the list reads as one continuous schedule, not a
// stack of floating pills. The right side is a two-line "date leaf": the
// verb as a small overline, the day as the strong line. "Today" keeps the
// loud gradient badge — that moment is the whole point of the app, and it
// should interrupt the calm of everything around it.
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
      className="flex w-full animate-fade-up items-center gap-4 px-4 py-3 text-left transition-colors duration-200 hover:bg-surface"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      {item.posterURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterURL}
          alt=""
          className="h-[72px] w-[50px] shrink-0 rounded-[8px] object-cover shadow-sm"
        />
      ) : (
        <div className="h-[72px] w-[50px] shrink-0 rounded-[8px] bg-gradient-to-br from-surface to-canvas" />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-ink">{item.title}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <TypeTag type={item.type} />
          {item.subtitle && <span className="text-[13px] text-subtle">{item.subtitle}</span>}
        </div>
      </div>

      {badge &&
        (isToday ? (
          <span className="shrink-0 animate-glow rounded-full bg-gradient-to-r from-accent to-accent-2 px-3 py-1.5 text-[12.5px] font-semibold text-on-accent shadow-md shadow-accent/30">
            {badge.label}
          </span>
        ) : (
          <div className="shrink-0 text-right">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
              {badge.verb ?? ""}
            </div>
            <div
              className={`mt-0.5 text-[13.5px] font-semibold ${
                isSoon ? "text-accent" : isPast ? "text-subtle" : "text-ink/75"
              }`}
            >
              {badge.when ?? badge.label}
            </div>
          </div>
        ))}
    </button>
  );
}
