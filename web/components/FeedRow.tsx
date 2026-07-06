import type { MediaItem } from "@/lib/types";
import TypeTag from "./TypeTag";

const URGENCY_STYLE: Record<"past" | "today" | "soon" | "later", string> = {
  past: "bg-surface text-subtle",
  today: "bg-emerald-50 text-emerald-700",
  soon: "bg-accent/10 text-accent",
  later: "bg-surface text-ink/70",
};

function urgencyFor(diffDays: number): keyof typeof URGENCY_STYLE {
  if (diffDays < 0) return "past";
  if (diffDays === 0) return "today";
  if (diffDays <= 6) return "soon";
  return "later";
}

export default function FeedRow({
  item,
  badge,
  onSelect,
}: {
  item: MediaItem;
  badge?: { label: string; diffDays: number };
  onSelect: (i: MediaItem) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface"
    >
      {item.posterURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterURL}
          alt=""
          className="h-[72px] w-12 shrink-0 rounded-lg object-cover shadow-sm"
        />
      ) : (
        <div className="h-[72px] w-12 shrink-0 rounded-lg bg-surface" />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-ink">{item.title}</div>
        <div className="mt-1 flex items-center gap-2">
          <TypeTag type={item.type} />
          {item.subtitle && <span className="text-[13px] text-subtle">{item.subtitle}</span>}
        </div>
      </div>

      {badge && (
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${
            URGENCY_STYLE[urgencyFor(badge.diffDays)]
          }`}
        >
          {badge.label}
        </span>
      )}
    </button>
  );
}
