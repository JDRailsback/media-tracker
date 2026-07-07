"use client";

import { useRouter } from "next/navigation";
import type { MediaItem } from "@/lib/types";

// Franchises are always shown in homogeneous grids (never inline-mixed with
// MediaCard — same reasoning as the old collection system), so this is a
// separate component rather than a branch inside MediaCard/Shelf. Theme
// colors come from item.theme (the API response), NOT a static import —
// franchise definitions are editable at runtime now (see
// lib/sources/franchise.ts), so a client-side static lookup would go stale
// the moment someone edits a franchise's colors.
export default function FranchiseCard({
  item,
  index = 0,
}: {
  item: MediaItem;
  index?: number;
}) {
  const router = useRouter();
  const slug = item.id.slice(item.id.indexOf(":") + 1);
  const primary = item.theme?.primary ?? "80 80 90";
  const secondary = item.theme?.secondary ?? "140 140 150";

  return (
    <button
      onClick={() => router.push(`/franchise/${slug}`)}
      className="group flex w-full animate-fade-up flex-col text-left"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div
        className="relative flex aspect-[2/3] w-full items-end overflow-hidden rounded-xl2 p-3 shadow-sm ring-1 ring-black/[0.04] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl dark:ring-white/[0.06]"
        style={{
          backgroundImage: `linear-gradient(155deg, rgb(${primary}), rgb(${secondary}))`,
        }}
      >
        {item.posterURL && (
          <>
            {/* A poster overrides the plain gradient — themed background
                still shows through as the underlay while the image loads. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.posterURL}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          </>
        )}
        <span className="relative text-[14px] font-bold leading-tight text-white drop-shadow-sm">
          {item.title}
        </span>
      </div>
      <div className="mt-2.5">
        <div className="line-clamp-2 text-[13.5px] font-semibold leading-tight text-ink">
          {item.title}
        </div>
        {item.subtitle && (
          <div className="mt-1 line-clamp-1 text-[12px] text-subtle">{item.subtitle}</div>
        )}
      </div>
    </button>
  );
}
