import type { MediaItem } from "@/lib/types";

// IGDB adapter (TS port). OAuth token + POST query body.

interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  cover?: { url?: string };
  first_release_date?: number; // Unix seconds
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

export async function searchIGDB(q: string): Promise<MediaItem[]> {
  const games = await query(
    `search "${q}"; fields name,summary,cover.url,first_release_date; limit 20;`
  );
  return games.map(mapGame);
}

export async function detailsIGDB(id: string): Promise<MediaItem> {
  const games = await query(
    `fields name,summary,cover.url,first_release_date; where id = ${id};`
  );
  if (games.length === 0) throw new Error(`Game ${id} not found`);
  return mapGame(games[0]);
}
