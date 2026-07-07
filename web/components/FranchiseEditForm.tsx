"use client";

import { useState } from "react";
import { X, Plus, Search, Trash2 } from "lucide-react";
import type { MediaItem, MediaType } from "@/lib/types";
import type { FranchiseQueries } from "@/lib/franchises";
import type { IncludedPart } from "@/lib/sources/franchise";

export interface FranchiseFormData {
  name: string;
  tagline: string;
  theme: { primary: string; secondary: string };
  queries: FranchiseQueries;
  movieCollectionId: number | null;
  featured: boolean;
  posterURL: string | null;
  bannerURL: string | null;
  includeOverrides: IncludedPart[];
  excludeIds: string[];
}

const PART_TYPES: { key: Exclude<MediaType, "franchise">; label: string }[] = [
  { key: "movie", label: "Movies" },
  { key: "tvShow", label: "TV" },
  { key: "game", label: "Games" },
  { key: "manga", label: "Manga" },
];

function rgbToHex(triplet: string): string {
  const [r, g, b] = triplet.split(" ").map((n) => Number(n) || 0);
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `${r} ${g} ${b}`;
}

function queriesToText(q: string | string[] | undefined): string {
  if (!q) return "";
  return (Array.isArray(q) ? q : [q]).join("\n");
}

function textToQueries(text: string): string[] | undefined {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
}

// Shared editor for both creating a brand-new custom franchise and editing
// an existing one (curated or custom) — same fields either way, only the
// save endpoint and the presence of delete/revert differs.
export default function FranchiseEditForm({
  mode,
  slug,
  initial,
  currentParts,
  isCustom,
  onSaved,
  onDeleted,
  onClose,
}: {
  mode: "create" | "edit";
  slug?: string;
  initial?: FranchiseFormData;
  // Currently auto-resolved parts (from the parent's already-fetched detail
  // payload) — used to offer a "hide" toggle without a second network call.
  // Not available in create mode (nothing resolved yet for a brand-new one).
  currentParts?: { movie: MediaItem[]; tvShow: MediaItem[]; game: MediaItem[]; manga: MediaItem[] };
  isCustom?: boolean;
  onSaved: (effective: FranchiseFormData & { slug: string }) => void;
  onDeleted?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [primary, setPrimary] = useState(initial?.theme.primary ?? "60 60 70");
  const [secondary, setSecondary] = useState(initial?.theme.secondary ?? "140 140 160");
  const [posterURL, setPosterURL] = useState(initial?.posterURL ?? "");
  const [bannerURL, setBannerURL] = useState(initial?.bannerURL ?? "");
  const [movieCollectionId, setMovieCollectionId] = useState(
    initial?.movieCollectionId != null ? String(initial.movieCollectionId) : ""
  );
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [queryText, setQueryText] = useState<Record<string, string>>({
    movie: queriesToText(initial?.queries.movie),
    tvShow: queriesToText(initial?.queries.tvShow),
    game: queriesToText(initial?.queries.game),
    manga: queriesToText(initial?.queries.manga),
  });
  const [includeOverrides, setIncludeOverrides] = useState<IncludedPart[]>(
    initial?.includeOverrides ?? []
  );
  const [excludeIds, setExcludeIds] = useState<string[]>(initial?.excludeIds ?? []);

  const [addQuery, setAddQuery] = useState("");
  const [addType, setAddType] = useState<Exclude<MediaType, "franchise">>("movie");
  const [addResults, setAddResults] = useState<MediaItem[]>([]);
  const [addSearching, setAddSearching] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddSearch() {
    if (!addQuery.trim()) return;
    setAddSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(addQuery)}&type=${addType}`);
      setAddResults(res.ok ? await res.json() : []);
    } finally {
      setAddSearching(false);
    }
  }

  function addInclude(item: MediaItem) {
    if (includeOverrides.some((i) => i.id === item.id)) return;
    setIncludeOverrides((list) => [
      ...list,
      {
        id: item.id,
        type: addType,
        title: item.title,
        posterURL: item.posterURL,
        releaseDate: item.releaseDate,
        overview: item.overview,
      },
    ]);
  }

  function removeInclude(id: string) {
    setIncludeOverrides((list) => list.filter((i) => i.id !== id));
  }

  function hidePart(id: string) {
    setExcludeIds((list) => (list.includes(id) ? list : [...list, id]));
  }

  function unhide(id: string) {
    setExcludeIds((list) => list.filter((i) => i !== id));
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const body: FranchiseFormData = {
      name: name.trim(),
      tagline,
      theme: { primary, secondary },
      queries: {
        movie: textToQueries(queryText.movie),
        tvShow: textToQueries(queryText.tvShow),
        game: textToQueries(queryText.game),
        manga: textToQueries(queryText.manga),
      },
      movieCollectionId: movieCollectionId.trim() ? Number(movieCollectionId) : null,
      featured,
      posterURL: posterURL.trim() || null,
      bannerURL: bannerURL.trim() || null,
      includeOverrides,
      excludeIds,
    };
    try {
      const url = mode === "create" ? "/api/franchise" : `/api/franchise/${slug}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError("Failed to save. Please try again.");
        return;
      }
      const saved = await res.json();
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!slug) return;
    setSaving(true);
    try {
      await fetch(`/api/franchise/${slug}`, { method: "DELETE" });
      onDeleted?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[88vh] w-full max-w-xl animate-scale-in flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-hairline"
      >
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="text-[16px] font-bold text-ink">
            {mode === "create" ? "New franchise" : `Edit ${initial?.name ?? "franchise"}`}
          </h2>
          <button onClick={onClose} className="text-subtle hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && <p className="text-[13px] text-red-500">{error}</p>}

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="e.g. Star Wars"
            />
          </Field>

          <Field label="Description / tagline">
            <textarea
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              rows={2}
              className="input resize-none"
              placeholder="A short line shown under the name."
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Primary color">
              <input
                type="color"
                value={rgbToHex(primary)}
                onChange={(e) => setPrimary(hexToRgb(e.target.value))}
                className="h-10 w-full cursor-pointer rounded-lg border border-hairline bg-transparent"
              />
            </Field>
            <Field label="Secondary color">
              <input
                type="color"
                value={rgbToHex(secondary)}
                onChange={(e) => setSecondary(hexToRgb(e.target.value))}
                className="h-10 w-full cursor-pointer rounded-lg border border-hairline bg-transparent"
              />
            </Field>
          </div>
          <div
            className="h-12 w-full rounded-lg"
            style={{ backgroundImage: `linear-gradient(155deg, rgb(${primary}), rgb(${secondary}))` }}
          />

          <Field label="Poster URL (used on cards and rows)">
            <input
              value={posterURL}
              onChange={(e) => setPosterURL(e.target.value)}
              className="input"
              placeholder="https://…"
            />
          </Field>

          <Field label="Banner URL (used on the detail page hero)">
            <input
              value={bannerURL}
              onChange={(e) => setBannerURL(e.target.value)}
              className="input"
              placeholder="https://… (leave blank to auto-pick from a matched title)"
            />
          </Field>

          <Field label="TMDB movie collection ID (optional)">
            <input
              value={movieCollectionId}
              onChange={(e) => setMovieCollectionId(e.target.value.replace(/[^0-9]/g, ""))}
              className="input"
              placeholder="e.g. 10 for the Star Wars Collection"
            />
            <p className="mt-1 text-[12px] text-subtle">
              When set, movies come from this TMDB collection instead of the text search below.
            </p>
          </Field>

          <label className="flex items-center gap-2 text-[13.5px] text-ink">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="h-4 w-4"
            />
            Featured on the Discover shelf
          </label>

          <div>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-subtle">
              Search queries per type
            </h3>
            <div className="space-y-3">
              {PART_TYPES.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <textarea
                    value={queryText[key]}
                    onChange={(e) => setQueryText((q) => ({ ...q, [key]: e.target.value }))}
                    rows={2}
                    className="input resize-none font-mono text-[12.5px]"
                    placeholder="One search term per line"
                  />
                </Field>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-subtle">
              Manually included titles
            </h3>
            {includeOverrides.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {includeOverrides.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg bg-canvas px-3 py-1.5 text-[13px] text-ink"
                  >
                    <span className="truncate">
                      {p.title} <span className="text-subtle">({p.type})</span>
                    </span>
                    <button onClick={() => removeInclude(p.id)} className="shrink-0 text-subtle hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value as Exclude<MediaType, "franchise">)}
                className="input w-28 shrink-0"
              >
                {PART_TYPES.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSearch())}
                placeholder="Search to add a title…"
                className="input flex-1"
              />
              <button
                onClick={handleAddSearch}
                className="shrink-0 rounded-lg bg-canvas px-3 text-subtle hover:text-ink"
              >
                <Search size={16} />
              </button>
            </div>
            {addSearching && <p className="mt-2 text-[12px] text-subtle">Searching…</p>}
            {addResults.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {addResults.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => addInclude(r)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] text-ink hover:bg-canvas"
                    >
                      <span className="truncate">{r.title}</span>
                      <Plus size={14} className="shrink-0 text-subtle" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {((currentParts &&
            Object.values(currentParts).some((list) => list.length > 0)) ||
            excludeIds.length > 0) && (
            <div>
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-subtle">
                Hidden from results
              </h3>
              {currentParts && (
                <ul className="mb-2 space-y-1">
                  {Object.values(currentParts)
                    .flat()
                    .filter((item) => !excludeIds.includes(item.id))
                    .map((item) => (
                      <li key={item.id} className="flex items-center justify-between px-1 text-[13px] text-ink">
                        <span className="truncate">{item.title}</span>
                        <button
                          onClick={() => hidePart(item.id)}
                          className="shrink-0 text-[12px] font-medium text-subtle hover:text-red-500"
                        >
                          Hide
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {excludeIds.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-canvas p-2">
                  {excludeIds.map((id) => (
                    <li key={id} className="flex items-center justify-between px-1 text-[12.5px] text-subtle">
                      <span className="truncate">{id}</span>
                      <button onClick={() => unhide(id)} className="shrink-0 font-medium text-accent hover:opacity-70">
                        Unhide
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-6 py-4">
          <div>
            {mode === "edit" && isCustom && (
              <button onClick={handleDelete} className="text-[13px] font-medium text-red-500 hover:opacity-80">
                Delete franchise
              </button>
            )}
            {mode === "edit" && !isCustom && (
              <button onClick={handleDelete} className="text-[13px] font-medium text-subtle hover:text-ink">
                Revert to default
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-full px-4 py-2 text-[14px] font-medium text-subtle hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-[14px] font-semibold text-on-accent shadow-sm shadow-accent/25 transition-all duration-200 hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-subtle">{label}</span>
      {children}
    </label>
  );
}
