import type { ExternalLink, MediaItem } from "@/lib/types";
import { isExactMatch, RankedItem } from "./textMatch";

// IGDB adapter (TS port). OAuth token + POST query body.

// Quality bar: released games need real rating volume; unreleased games get a
// pass (they legitimately have none yet) as long as they have cover art.
const MIN_RATING_COUNT = 5;

// A non-exact match (e.g. a niche edition like "Minecraft Education" when you
// search "minecraft") needs to be much more significant to show up at all.
// Searching its exact name still finds it (exact match = lenient bar above).
// Applies ONLY to already-released games — see passesQualityBar.
const NON_EXACT_MIN_RATING_COUNT = 50;

interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  cover?: { url?: string };
  first_release_date?: number; // Unix seconds
  total_rating_count?: number;
  hypes?: number;
  game_type?: number | null;
}

function passesQualityBar(g: IGDBGame, isExact: boolean): boolean {
  if (!g.cover?.url) return false;
  const isFuture = g.first_release_date
    ? g.first_release_date * 1000 > Date.now()
    : true;
  // Unreleased/announced games ALWAYS get a pass, exact match or not — same
  // reasoning as the TMDB adapter: surfacing new announcements before they
  // have engagement data is the whole point, so the elevated non-exact bar
  // only applies to already-released games (where tie-in/edition spam lives).
  if (isFuture) return true;
  const minCount = isExact ? MIN_RATING_COUNT : NON_EXACT_MIN_RATING_COUNT;
  return (g.total_rating_count ?? 0) >= minCount;
}

// Would this game clear the bar even judged as a non-exact match? Ranking
// signal only (see RankedItem) — lets a hugely popular near-match outrank an
// obscure exact-match title.
function isSignificant(g: IGDBGame): boolean {
  const isFuture = g.first_release_date ? g.first_release_date * 1000 > Date.now() : true;
  if (isFuture) return (g.hypes ?? 0) > 0;
  return (g.total_rating_count ?? 0) >= NON_EXACT_MIN_RATING_COUNT;
}

// IGDB tags every sub-entry (seasons, episodes, DLC, packs, updates...) as
// its own "game" with a `game_type`. Verified LIVE against real responses
// (see docs/DISCOVER_AND_SEARCH.md) — searching "fortnite"/"minecraft" and
// inspecting the raw game_type per result:
//   7 = season      ("Fortnite: Season 6/7/8...")
//   13 = pack        ("Fortnite Festival: <song>", "Minecraft: ... Skin Pack")
//   6 = episode      ("Minecraft: Story Mode - Episode 5")
//   14 = update      ("Minecraft: Nether Update", "Caves & Cliffs")
//   5 = dlc_addon    ("A Minecraft Movie DLC")
//   3 = bundle       ("Minecraft Dungeons: Ultimate DLC Bundle")
//   2 = expansion    ("Fortnite: Save the World", "LEGO Fortnite")
// A DENYLIST, not an allowlist: the real flagship "Minecraft" entry itself
// is tagged 11 ("port"), not 0 ("main_game") — an allowlist of just {0}
// silently excluded the actual base game. Deny only the confirmed-junk
// types; let everything else (0, 11, and anything unobserved) through.
const JUNK_GAME_TYPES = new Set([2, 3, 5, 6, 7, 13, 14]);

function isMainGame(g: IGDBGame): boolean {
  return g.game_type == null || !JUNK_GAME_TYPES.has(g.game_type);
}

async function getToken(): Promise<string> {
  const id = process.env.IGDB_CLIENT_ID;
  const secret = process.env.IGDB_CLIENT_SECRET;
  if (!id || !secret) throw new Error("IGDB credentials not set");

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`IGDB auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

async function query(body: string): Promise<IGDBGame[]> {
  const clientID = process.env.IGDB_CLIENT_ID as string;
  const token = await getToken();

  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": clientID, Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new Error(`IGDB request failed: ${res.status}`);
  return (await res.json()) as IGDBGame[];
}

function mapGame(g: IGDBGame): MediaItem {
  let posterURL: string | undefined;
  if (g.cover?.url) {
    const big = g.cover.url.replace("t_thumb", "t_cover_big");
    posterURL = big.startsWith("//") ? `https:${big}` : big;
  }
  return {
    id: `game:${g.id}`,
    type: "game",
    title: g.name,
    overview: g.summary,
    posterURL,
    releaseDate: g.first_release_date
      ? new Date(g.first_release_date * 1000).toISOString()
      : undefined,
  };
}

const SEARCH_FIELDS = "name,summary,cover.url,first_release_date,total_rating_count,hypes,game_type";

// IGDB sometimes has more than one entry for the same title (e.g. a
// main_game AND a separate port/edition entry both literally named
// "Fortnite"). Keep only the highest-signal one per exact title.
function dedupeByTitle(games: IGDBGame[]): IGDBGame[] {
  const best = new Map<string, IGDBGame>();
  for (const g of games) {
    const key = g.name.trim().toLowerCase();
    const existing = best.get(key);
    if (!existing || (g.total_rating_count ?? 0) > (existing.total_rating_count ?? 0)) {
      best.set(key, g);
    }
  }
  return [...best.values()];
}

export async function searchIGDB(q: string): Promise<RankedItem[]> {
  // Fetch a larger raw candidate pool since filtering (quality + main-game)
  // happens after the fetch, not in the query itself.
  const games = await query(`search "${q}"; fields ${SEARCH_FIELDS}; limit 50;`);
  return dedupeByTitle(
    games.filter(isMainGame).filter((g) => passesQualityBar(g, isExactMatch(g.name, q)))
  ).map((g) => ({ ...mapGame(g), significant: isSignificant(g) }));
}

// Recognized storefront domains. Verified live against a real IGDB response
// (The Witcher 3): IGDB's `websites` field has NO usable category field (it
// came back empty even when requested), so we match by URL domain instead —
// robust and doesn't depend on an undocumented/uncertain enum.
const STORE_DOMAINS: { pattern: string; provider: string }[] = [
  { pattern: "store.steampowered.com", provider: "Steam" },
  { pattern: "epicgames.com", provider: "Epic Games Store" },
  { pattern: "xbox.com", provider: "Xbox" },
  { pattern: "playstation.com", provider: "PlayStation Store" },
  { pattern: "nintendo.com", provider: "Nintendo eShop" },
  { pattern: "gog.com", provider: "GOG" },
];

function storeLinks(websites: { url?: string }[] | undefined): ExternalLink[] | undefined {
  if (!websites) return undefined;
  const links: ExternalLink[] = [];
  for (const w of websites) {
    if (!w.url) continue;
    const match = STORE_DOMAINS.find((d) => w.url!.includes(d.pattern));
    if (match) links.push({ provider: match.provider, url: w.url, kind: "store" });
  }
  return links.length ? links : undefined;
}

export async function detailsIGDB(id: string): Promise<MediaItem> {
  const games = await query(
    `fields name,summary,cover.url,first_release_date,websites.url; where id = ${id};`
  );
  if (games.length === 0) throw new Error(`Game ${id} not found`);
  const game = games[0] as IGDBGame & { websites?: { url?: string }[] };
  const item = mapGame(game);
  item.externalLinks = storeLinks(game.websites);
  return item;
}

// Popular, already-released games (for the Discover page's "Popular games" shelf).
export async function discoverIGDBPopular(limit = 20): Promise<MediaItem[]> {
  const games = await query(
    `fields ${SEARCH_FIELDS}; where total_rating_count > 50 & cover != null; sort total_rating_count desc; limit ${limit * 2};`
  );
  return games.filter(isMainGame).slice(0, limit).map(mapGame);
}

// Anticipated, not-yet-released games (for "Popular upcoming").
export async function discoverIGDBUpcoming(limit = 12): Promise<MediaItem[]> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const games = await query(
    `fields ${SEARCH_FIELDS}; where first_release_date > ${nowSeconds} & cover != null & hypes != null; sort hypes desc; limit ${limit * 2};`
  );
  return games.filter(isMainGame).slice(0, limit).map(mapGame);
}
