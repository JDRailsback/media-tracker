import type { MediaType } from "@/lib/types";

const STYLE: Record<MediaType, { label: string; className: string }> = {
  movie: {
    label: "Movie",
    className: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  tvShow: {
    label: "TV",
    className: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
  game: {
    label: "Game",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  manga: {
    label: "Manga",
    className: "bg-pink-50 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
  },
  collection: {
    label: "Franchise",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
};

export default function TypeTag({ type }: { type: MediaType }) {
  const s = STYLE[type];
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${s.className}`}>
      {s.label}
    </span>
  );
}
