import type { MediaItem } from "@/lib/types";
import MediaCard from "./MediaCard";

export default function Shelf({
  title,
  items,
  onSelect,
  onSeeAll,
  renderItem,
  itemWidthClassName = "w-32 sm:w-36",
}: {
  title: string;
  items: MediaItem[];
  onSelect: (i: MediaItem) => void;
  onSeeAll: () => void;
  // Overrides the default poster-card markup entirely (including its own
  // sizing/click handling) — used by the Collections shelf, whose cards are
  // theme-colored rather than poster-image-based. Shelf still owns the
  // header/"See all"/scroll-container chrome and the fade-up stagger.
  renderItem?: (item: MediaItem, index: number) => React.ReactNode;
  // Collection cards are deliberately wider than the default poster-card
  // width, to stay visually distinct from regular media in a mixed page.
  itemWidthClassName?: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mb-9">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
        <button
          onClick={onSeeAll}
          className="text-[13px] font-medium text-accent transition-opacity hover:opacity-70"
        >
          See all
        </button>
      </div>
      <div className="scrollbar-none flex gap-4 overflow-x-auto pb-1">
        {items.map((item, i) =>
          renderItem ? (
            <div
              key={item.id}
              className={`shrink-0 animate-fade-up ${itemWidthClassName}`}
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            >
              {renderItem(item, i)}
            </div>
          ) : (
            <div key={item.id} className={`shrink-0 ${itemWidthClassName}`}>
              <MediaCard item={item} index={i} onSelect={onSelect} />
            </div>
          )
        )}
      </div>
    </section>
  );
}
