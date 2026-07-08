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
//
// Deliberately a WIDER, landscape (3:2) tile instead of MediaCard's portrait
// 2:3 poster — franchises aren't a single title with box art, they're a
// themed collection, and the wider shape keeps them visually distinct in a
// mixed grid. No text is ever drawn over the image itself (title/tagline
// always sit below, exactly like MediaCard) — a custom poster someone adds
// through the editor isn't guaranteed to be a clean backdrop for overlaid
// text, and the always-on gradient+text overlay this used to have was also
// the source of a hover-rendering glitch (the image was absolutely
// positioned under a persistent gradient/text layer, unlike MediaCard's
// proven normal-flow image + hover-only overlay).
export default function CollectionCard({
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
      onClick={() => router.push(`/collection/${slug}`)}
      className="group flex w-full animate-fade-up flex-col text-left"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl2 shadow-sm ring-1 ring-black/[0.04] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl dark:ring-white/[0.06]">
        {item.posterURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.posterURL}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ backgroundImage: `linear-gradient(155deg, rgb(${primary}), rgb(${secondary}))` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
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
