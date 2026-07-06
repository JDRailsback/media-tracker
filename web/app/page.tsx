"use client";

import { useEffect, useState } from "react";
import { Search as SearchIcon, Bell, Sparkles } from "lucide-react";
import type { MediaItem } from "@/lib/types";
import { addFollow, getFollowed, isFollowed, removeFollow, FollowedItem } from "@/lib/library";
import { buildFeed, describeRelease } from "@/lib/feed";
import { enablePush, syncFollow } from "@/lib/push-client";
import DetailModal from "@/components/DetailModal";
import MediaCard from "@/components/MediaCard";
import FeedRow from "@/components/FeedRow";
import Sidebar, { View } from "@/components/Sidebar";

export default function Home() {
  const [view, setView] = useState<View>("feed");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [followed, setFollowed] = useState<FollowedItem[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);

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

  function handleFollow(item: MediaItem) {
    addFollow(item);
    void syncFollow(item.id, true);
    setFollowed(getFollowed());
  }

  function handleUnfollow(id: string) {
    removeFollow(id);
    void syncFollow(id, false);
    setFollowed(getFollowed());
  }

  async function handleEnablePush() {
    setPushEnabled(await enablePush());
  }

  const feed = buildFeed(followed);
  const selectedFollowed = selected ? isFollowed(selected.id) : false;

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar active={view} onChange={setView} />

      <main className="mx-auto max-w-3xl px-6 py-10 md:ml-60 md:px-10">
        {view === "feed" && (
          <>
            <PageHeader title="Home" subtitle="What's new with what you follow." />
            {feed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="You're all caught up"
                text="Follow a movie, show, game, or manga in Discover to see release updates here."
              />
            ) : (
              <div className="space-y-8">
                {feed.map((group) => (
                  <section key={group.key}>
                    <h2 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-subtle">
                      {group.title}
                    </h2>
                    <div className="rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-black/[0.03]">
                      {group.items.map((item) => (
                        <FeedRow
                          key={item.id}
                          item={item}
                          badge={describeRelease(item) ?? undefined}
                          onSelect={setSelected}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {view === "discover" && (
          <>
            <PageHeader title="Discover" subtitle="Search movies, TV, games, and manga." />
            <form onSubmit={search} className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/[0.03]">
              <SearchIcon size={18} className="text-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for something to follow…"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-subtle"
              />
            </form>

            {loading && <p className="mt-4 text-[13px] text-subtle">Searching…</p>}

            {results.length > 0 && (
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
                {results.map((item) => (
                  <MediaCard key={item.id} item={item} onSelect={setSelected} />
                ))}
              </div>
            )}
          </>
        )}

        {view === "following" && (
          <>
            <PageHeader title="Following" subtitle={`${followed.length} item${followed.length === 1 ? "" : "s"}.`} />
            {followed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="Nothing followed yet"
                text="Find something in Discover and follow it to start tracking releases."
              />
            ) : (
              <div className="rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-black/[0.03]">
                {followed.map((item) => (
                  <FeedRow
                    key={item.id}
                    item={item}
                    badge={describeRelease(item) ?? undefined}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {view === "settings" && (
          <>
            <PageHeader title="Settings" />
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.03]">
              <button
                onClick={handleEnablePush}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface"
              >
                <Bell size={18} className="text-accent" />
                <span className="flex-1 text-[15px] text-ink">Enable notifications</span>
                {pushEnabled && <span className="text-[13px] text-subtle">On</span>}
              </button>
            </div>
          </>
        )}
      </main>

      {selected && (
        <DetailModal
          item={selected}
          isFollowed={selectedFollowed}
          onFollow={handleFollow}
          onUnfollow={() => handleUnfollow(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-[14px] text-subtle">{subtitle}</p>}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-black/[0.03]">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface">
        {icon}
      </div>
      <div className="text-[15px] font-medium text-ink">{title}</div>
      <p className="mt-1 max-w-xs text-[13.5px] text-subtle">{text}</p>
    </div>
  );
}
