import type { MediaItem } from "@/lib/types";
import TypeTag from "./TypeTag";

// Poster-forward grid card, used in Discover results.
export default function MediaCard({
  item,
  onSelect,
}: {
  item: MediaItem;
  onSelect: (i: MediaItem) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className="group flex flex-col text-left"
    >
      <div className="aspect-[2/3] w-full overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/[0.04] transition-shadow group-hover:shadow-md">
        {item.posterURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.posterURL}
            alt=""
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-subtle">
            No image
          </div>
        )}
      </div>
      <div className="mt-2">
        <div className="line-clamp-2 text-[13.5px] font-medium leading-tight text-ink">
          {item.title}
        </div>
        <div className="mt-1">
          <TypeTag type={item.type} />
        </div>
      </div>
    </button>
  );
}
