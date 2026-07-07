"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import MediaCard from "./MediaCard";

// A single, non-wrapping horizontal row per category (Movies/TV/Games/Manga,
// and the combined "Most Popular" row) — arrow buttons scroll the row rather
// than the page growing into a multi-row grid, since a franchise can have
// dozens of parts (One Piece alone has 15+ movies).
export default function FranchiseRow({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
        <div className="flex gap-1">
          <button
            onClick={() => scroll(-1)}
            aria-label={`Scroll ${title} left`}
            className="rounded-full p-1.5 text-subtle transition-colors hover:bg-surface hover:text-ink"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => scroll(1)}
            aria-label={`Scroll ${title} right`}
            className="rounded-full p-1.5 text-subtle transition-colors hover:bg-surface hover:text-ink"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="scrollbar-none flex gap-4 overflow-x-auto scroll-smooth pb-1">
        {items.map((item, i) => (
          <div key={item.id} className="w-32 shrink-0 sm:w-36">
            <MediaCard item={item} index={i} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </section>
  );
}
