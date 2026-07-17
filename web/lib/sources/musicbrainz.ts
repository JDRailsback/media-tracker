import type { ReleaseGroupInfo } from "@/lib/types";

// MusicBrainz adapter — supplements Deezer with the one thing no commercial
// streaming API exposes: FUTURE release dates. MusicBrainz release-groups
// are community-entered, so announced-but-unreleased albums from known
// artists usually exist here with a first-release-date weeks/months out.
// Keyless, but with two hard policy requirements (per MusicBrainz's API
// docs): max 1 request/second per IP, and a meaningful User-Agent
// identifying the app — anonymous or over-rate clients get blocked.

const USER_AGENT = "Trackr/1.0 (personal media release tracker)";

let gate: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100; // 1 rps with a little margin

function throttle(): Promise<void> {
  gate = gate.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  return gate;
}

async function mbGET<T>(path: string): Promise<T> {
  await throttle();
  const res = await fetch(`https://musicbrainz.org/ws/2${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`MusicBrainz request failed (${path}): ${res.status}`);
  return (await res.json()) as T;
}

interface MBArtistSearchResult {
  artists?: { id: string; name: string; score?: number }[];
}

// Name -> MBID. MusicBrainz's search scores results 0-100; only a
// high-confidence hit whose name matches (case-insensitive) is accepted —
// a wrong artist's discography merged in would be far worse than none
// (the caller just skips future dates when this returns null).
export async function resolveMBID(artistName: string): Promise<string | null> {
  try {
    const data = await mbGET<MBArtistSearchResult>(
      `/artist?query=artist:${encodeURIComponent(JSON.stringify(artistName))}&limit=3&fmt=json`
    );
    const candidate = (data.artists ?? [])[0];
    if (!candidate) return null;
    if ((candidate.score ?? 0) < 90) return null;
    if (candidate.name.trim().toLowerCase() !== artistName.trim().toLowerCase()) return null;
    return candidate.id;
  } catch {
    return null;
  }
}

interface MBReleaseGroup {
  title: string;
  "primary-type"?: string | null; // "Album" | "Single" | "EP" | "Broadcast" | "Other"
  "secondary-types"?: string[]; // ["Compilation"], ["Live"], ["Remix"], ...
  "first-release-date"?: string; // "YYYY-MM-DD" | "YYYY-MM" | "YYYY" | ""
}

interface MBReleaseGroupList {
  "release-groups"?: MBReleaseGroup[];
  "release-group-count"?: number;
}

// Secondary types that mean "not new original work" — a compilation, live
// recording, or remix album shouldn't appear in the release feed.
const SKIP_SECONDARY = new Set(["Compilation", "Live", "Remix", "DJ-mix", "Mixtape/Street", "Demo", "Interview", "Soundtrack"]);

function mapKind(primary?: string | null): ReleaseGroupInfo["kind"] | null {
  if (primary === "Album") return "album";
  if (primary === "EP") return "ep";
  if (primary === "Single") return "single";
  return null; // Broadcast/Other/untyped — skip
}

// A YYYY or YYYY-MM date can't be placed on a day-precision release
// calendar; normalized to undefined ("announced, date TBA") rather than
// inventing a day.
function normalizeDate(d?: string): string | undefined {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

const RG_PAGE_SIZE = 100;
const MAX_RG_PAGES = 4;

export async function mbReleaseGroups(mbid: string): Promise<ReleaseGroupInfo[]> {
  const releases: ReleaseGroupInfo[] = [];
  for (let page = 0; page < MAX_RG_PAGES; page++) {
    const data = await mbGET<MBReleaseGroupList>(
      `/release-group?artist=${mbid}&limit=${RG_PAGE_SIZE}&offset=${page * RG_PAGE_SIZE}&fmt=json`
    );
    const groups = data["release-groups"] ?? [];
    for (const rg of groups) {
      const kind = mapKind(rg["primary-type"]);
      if (!kind) continue;
      if ((rg["secondary-types"] ?? []).some((t) => SKIP_SECONDARY.has(t))) continue;
      releases.push({ title: rg.title, kind, date: normalizeDate(rg["first-release-date"]) });
    }
    if (groups.length < RG_PAGE_SIZE) break;
  }
  return releases;
}
