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
import ThemeToggle from "@/components/ThemeToggle";
import AmbientBackground from "@/components/AmbientBackground";

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
    <div className="relative min-h-screen bg-canvas">
      <AmbientBackground />
      <Sidebar active={view} onChange={setView} />

      <main className="relative mx-auto max-w-3xl px-6 py-12 md:ml-64 md:px-12">
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
              <div className="space-y-9">
                {feed.map((group) => (
                  <section key={group.key}>
                    <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-subtle">
                      {group.title}
                    </h2>
                    <div className="rounded-2xl border border-hairline bg-panel/70 p-1.5 shadow-sm backdrop-blur-xl">
                      {group.items.map((item, i) => (
                        <FeedRow
                          key={item.id}
                          item={item}
                          index={i}
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
            <form
              onSubmit={search}
              className="flex items-center gap-2.5 rounded-xl border border-hairline bg-panel/70 px-4 py-3 shadow-sm backdrop-blur-xl transition-shadow focus-within:shadow-md focus-within:shadow-accent/10"
            >
              <SearchIcon size={18} className="text-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for something to follow…"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
              />
            </form>

            {loading && <SearchSkeleton />}

            {!loading && results.length > 0 && (
              <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
                {results.map((item, i) => (
                  <MediaCard key={item.id} item={item} index={i} onSelect={setSelected} />
                ))}
              </div>
            )}
          </>
        )}

        {view === "following" && (
          <>
            <PageHeader
              title="Following"
              subtitle={`${followed.length} item${followed.length === 1 ? "" : "s"}.`}
            />
            {followed.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} className="text-subtle" />}
                title="Nothing followed yet"
                text="Find something in Discover and follow it to start tracking releases."
              />
            ) : (
              <div className="rounded-2xl border border-hairline bg-panel/70 p-1.5 shadow-sm backdrop-blur-xl">
                {followed.map((item, i) => (
                  <FeedRow
                    key={item.id}
                    item={item}
                    index={i}
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
            <div className="space-y-4">
              <SettingsRow label="Appearance">
                <ThemeToggle />
              </SettingsRow>
              <SettingsRow label="Notifications">
                <button
                  onClick={handleEnablePush}
                  className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1.5 text-[13px] font-semibold text-on-accent shadow-sm shadow-accent/25 transition-all duration-200 hover:brightness-110 active:scale-95"
                >
                  <Bell size={14} />
                  {pushEnabled ? "Enabled" : "Enable"}
                </button>
              </SettingsRow>
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
    <div className="mb-7 animate-fade-up">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[14px] text-subtle">{subtitle}</p>}
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-hairline bg-panel/70 px-5 py-4 shadow-sm backdrop-blur-xl">
      <span className="text-[15px] font-medium text-ink">{label}</span>
      {children}
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
    <div className="flex animate-fade-up flex-col items-center rounded-2xl border border-hairline bg-panel/70 px-6 py-16 text-center shadow-sm backdrop-blur-xl">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent/15 to-accent-2/10">
        {icon}
      </div>
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <p className="mt-1 max-w-xs text-[13.5px] text-subtle">{text}</p>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] w-full rounded-xl2 bg-gradient-to-br from-surface to-panel" />
          <div className="mt-2.5 h-3 w-4/5 rounded bg-surface" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface" />
        </div>
      ))}
    </div>
  );
}
