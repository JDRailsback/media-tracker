"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  // Hooks must run every render regardless of the items.length===0 early
  // return below (rules of hooks) — so these live above it.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Height of just the poster art (not the title/type-tag caption below it),
  // so the arrows can center on the artwork instead of the whole card — both
  // MediaCard and CollectionCard render their image box as the first child,
  // sized via an `aspect-*` class, which is what this measures.
  const [posterHeight, setPosterHeight] = useState<number | null>(null);

  // Recomputed on scroll, on mount, and whenever the item count changes (a
  // shorter items list after a filter change can flip a shelf from
  // scrollable to fully-visible) — a ResizeObserver also catches the
  // window/viewport resizing wider than the shelf's content.
  function updateArrowVisibility() {
    const el = scrollRef.current;
    if (!el) return;
    // 2px slack absorbs sub-pixel rounding at either end.
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }

  useEffect(() => {
    updateArrowVisibility();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrowVisibility, { passive: true });
    const rowObserver = new ResizeObserver(updateArrowVisibility);
    rowObserver.observe(el);

    // Separate observer on the poster box itself (not just the row) — its
    // height depends on image aspect-ratio + column width, which can settle
    // a moment after mount, so the row's own ResizeObserver alone (its
    // outer size doesn't necessarily change) isn't enough to catch it.
    const posterEl = el.querySelector<HTMLElement>('[class*="aspect-"]');
    const posterObserver = posterEl
      ? new ResizeObserver(([entry]) => setPosterHeight(entry.contentRect.height))
      : null;
    if (posterEl && posterObserver) posterObserver.observe(posterEl);

    return () => {
      el.removeEventListener("scroll", updateArrowVisibility);
      rowObserver.disconnect();
      posterObserver?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function scroll(direction: -1 | 1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  }

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
      <div className="relative">
        {canScrollLeft && (
          <div className="pointer-events-none absolute left-0 top-0 z-[5] h-full w-8 bg-gradient-to-r from-canvas to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-0 z-[5] h-full w-8 bg-gradient-to-l from-canvas to-transparent" />
        )}
        <div
          ref={scrollRef}
          className="scrollbar-none flex gap-4 overflow-x-auto scroll-smooth pb-1"
        >
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
        {canScrollLeft && (
          <button
            onClick={() => scroll(-1)}
            aria-label={`Scroll ${title} left`}
            style={posterHeight ? { top: posterHeight / 2 } : undefined}
            className="absolute left-1 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity hover:opacity-70"
          >
            <ChevronLeft size={26} strokeWidth={2.5} />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll(1)}
            aria-label={`Scroll ${title} right`}
            style={posterHeight ? { top: posterHeight / 2 } : undefined}
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 translate-x-1/2 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-opacity hover:opacity-70"
          >
            <ChevronRight size={26} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </section>
  );
}
