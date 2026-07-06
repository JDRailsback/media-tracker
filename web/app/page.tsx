"use client";

import { useEffect, useState } from "react";
import type { MediaItem } from "@/lib/types";
import { addFollow, getFollowed, isFollowed, removeFollow } from "@/lib/library";
import { enablePush, syncFollow } from "@/lib/push-client";
import DetailModal from "@/components/DetailModal";

type Tab = "discover" | "library" | "upcoming";

export default function Home() {
  const [tab, setTab] = useState<Tab>("discover");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [followed, setFollowed] = useState<MediaItem[]>([]);

  useEffect(() => setFollowed(getFollowed()), []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      setResults(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }

  function toggleFollow(item: MediaItem) {
    if (isFollowed(item.id)) {
      removeFollow(item.id);
      void syncFollow(item.id, false);
    } else {
      addFollow(item);
      void syncFollow(item.id, true);
    }
    setFollowed(getFollowed());
  }

  const upcoming = followed
    .filter((i) => i.releaseDate && new Date(i.releaseDate) >= new Date())
    .sort((a, b) => (a.releaseDate! < b.releaseDate! ? -1 : 1));

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Media Tracker</h1>
        <button onClick={() => enablePush()}>Enable notifications</button>
      </header>

      <nav style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        {(["discover", "library", "upcoming"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ fontWeight: tab === t ? 700 : 400 }}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "discover" && (
        <>
          <form onSubmit={search} style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Movies, games, manga…"
              style={{ flex: 1, padding: 8 }}
            />
            <button type="submit">Search</button>
          </form>
          {loading && <p>Searching…</p>}
          <MediaList items={results} onSelect={setSelected} />
        </>
      )}

      {tab === "library" &&
        (followed.length ? (
          <MediaList items={followed} onSelect={setSelected} />
        ) : (
          <p style={{ color: "#666" }}>Nothing followed yet.</p>
        ))}

      {tab === "upcoming" &&
        (upcoming.length ? (
          <MediaList items={upcoming} onSelect={setSelected} showDate />
        ) : (
          <p style={{ color: "#666" }}>No upcoming releases.</p>
        ))}

      {selected && (
        <DetailModal
          item={selected}
          isFollowed={isFollowed(selected.id)}
          onToggleFollow={(full) => {
            toggleFollow(full);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

function MediaList({
  items,
  onSelect,
  showDate,
}: {
  items: MediaItem[];
  onSelect: (i: MediaItem) => void;
  showDate?: boolean;
}) {
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12, marginTop: 12 }}>
      {items.map((item) => (
        <li
          key={item.id}
          onClick={() => onSelect(item)}
          style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}
        >
          {item.posterURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.posterURL} alt="" width={46} height={69} style={{ borderRadius: 6, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 46, height: 69, background: "#eee", borderRadius: 6 }} />
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{item.title}</div>
            <div style={{ fontSize: 13, color: "#666" }}>
              {item.type}
              {showDate && item.releaseDate
                ? ` · ${new Date(item.releaseDate).toLocaleDateString()}`
                : item.subtitle
                ? ` · ${item.subtitle}`
                : ""}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
