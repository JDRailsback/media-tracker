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
  // Discover page's upcoming/new-releases/just-announced shelves, where
  // seeing the date is the whole point of the row. Omitted everywhere else
  // (Trending/Popular shelves, search results) since a plain title+type is
  // enough there.
  dateLabel?: string;
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className="group flex animate-fade-up flex-col text-left"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl2 bg-surface shadow-sm ring-1 ring-black/[0.04] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-accent/10 dark:ring-white/[0.06]">
        {item.posterURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.posterURL}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-canvas text-[12px] text-subtle">
            No image
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
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
