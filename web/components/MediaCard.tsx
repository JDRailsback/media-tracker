import type { MediaItem } from "@/lib/types";
import TypeTag from "./TypeTag";

export default function MediaCard({
  item,
  onSelect,
  index = 0,
  dateLabel,
}: {
  item: MediaItem;
  onSelect: (i: MediaItem) => void;
  index?: number;
  // Formatted release-date pill, e.g. "Jul 15" or "TBA" — used by the
  // Discover page's upcoming/new-releases shelves, where seeing the date is
  // the whole point of the row. Omitted everywhere else (Trending shelves,
  // search results) since a plain title+type is enough there.
  dateLabel?: string;
}) {
  // Artists are people, not titled works — a round portrait instead of the
  // 2:3 poster keeps them instantly distinguishable in any mixed grid, with
  // the name/tag centered under the circle.
  if (item.type === "artist") {
    return (
      <button
        onClick={() => onSelect(item)}
        className="group flex w-full animate-fade-up flex-col items-center text-center"
        style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      >
        <div className="aspect-square w-[85%] overflow-hidden rounded-full bg-surface ring-1 ring-hairline transition-transform duration-300 group-hover:-translate-y-1">
          {item.posterURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.posterURL} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[12px] text-subtle">
              No image
            </div>
          )}
        </div>
        <div className="mt-2.5">
          <div className="line-clamp-2 text-[13.5px] font-semibold leading-tight text-ink">
            {item.title}
          </div>
          <div className="mt-1.5">
            <TypeTag type={item.type} />
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(item)}
      className="group flex animate-fade-up flex-col text-left"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl2 bg-surface ring-1 ring-hairline transition-transform duration-300 group-hover:-translate-y-1">
        {item.posterURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.posterURL} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface text-[12px] text-subtle">
            No image
          </div>
        )}
        {dateLabel && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur-sm">
            {dateLabel}
          </span>
        )}
      </div>
      <div className="mt-2.5">
        <div className="line-clamp-2 text-[13.5px] font-semibold leading-tight text-ink">
          {item.title}
        </div>
        <div className="mt-1.5">
          <TypeTag type={item.type} />
        </div>
      </div>
    </button>
  );
}
