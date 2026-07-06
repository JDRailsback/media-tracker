import type { MediaType } from "@/lib/types";

const STYLE: Record<MediaType, { label: string; className: string }> = {
  movie: { label: "Movie", className: "bg-blue-50 text-blue-700" },
  tvShow: { label: "TV", className: "bg-violet-50 text-violet-700" },
  game: { label: "Game", className: "bg-emerald-50 text-emerald-700" },
  manga: { label: "Manga", className: "bg-rose-50 text-rose-700" },
};

export default function TypeTag({ type }: { type: MediaType }) {
  const s = STYLE[type];
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
