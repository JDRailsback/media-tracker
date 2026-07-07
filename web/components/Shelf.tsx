import type { MediaItem } from "@/lib/types";

export default function Shelf({
  title,
  items,
  onSelect,
  onSeeAll,
  renderItem,
}: {
  title: string;
  items: MediaItem[];
  onSelect: (i: MediaItem) => void;
  onSeeAll: () => void;
  // Overrides the default poster-card markup entirely (including its own
  // sizing/click handling) — used by the Franchises shelf, whose cards are
  // theme-colored rather than poster-image-based. Shelf still owns the
  // header/"See all"/scroll-container chrome and the fade-up stagger.
  renderItem?: (item: MediaItem, index: number) => React.ReactNode;
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
              className="w-32 shrink-0 animate-fade-up sm:w-36"
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            >
              {renderItem(item, i)}
            </div>
          ) : (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="group w-32 shrink-0 animate-fade-up text-left sm:w-36"
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
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
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-canvas text-[11px] text-subtle">
                    No image
                  </div>
                )}
              </div>
              <div className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
                {item.title}
              </div>
            </button>
          )
        )}
      </div>
    </section>
  );
}
