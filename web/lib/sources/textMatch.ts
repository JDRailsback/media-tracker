import type { MediaItem } from "@/lib/types";

// Shared text-relevance helpers, used both to rank combined search results
// and to decide how strict the popularity bar should be per-adapter (see
// docs/DISCOVER_AND_SEARCH.md — "importance filtering").

// Search-only, internal ranking signal: would this item still be considered
// significant even judged as a NON-exact match (i.e. does it clear each
// adapter's stricter bar)? Lets a hugely popular near-match (e.g. "Toy Story
// 2") outrank a barely-passing exact match (e.g. an obscure "Toy Story"
// game) instead of exact-match always winning outright. Computed by each
// adapter's search function, used only inside the ranking pipeline in
// lib/sources/index.ts, and stripped before the API response is returned —
// never part of the public MediaItem contract.
export interface RankedItem extends MediaItem {
  significant: boolean;
}

// Lowercase AND strip accents/diacritics — a real title is often "Pokémon"
// while a typed query is plain "pokemon"; without this they're two entirely
// different strings as far as string comparison is concerned, which quietly
// broke matching (and typo tolerance) for any accented title.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
}

export function isExactMatch(title: string, query: string): boolean {
  return normalize(title) === normalize(query);
}

// 0 = exact, 1 = starts with the query, 2 = contains it, 3 = anything else.
export function matchTier(title: string, query: string): number {
  const t = normalize(title);
  const q = normalize(query);
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return 3;
}

// Levenshtein edit distance (single-row DP — O(min(a,b)) memory).
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
      );
    }
    prev = row;
  }
  return prev[b.length];
}

// How many typos to tolerate for a query of this length — short queries can't
// absorb much before they stop meaning anything; longer ones can take a
// couple of character slips.
function typoBudget(queryLength: number): number {
  if (queryLength <= 4) return 1;
  if (queryLength <= 9) return 1;
  return 2;
}

// A misspelling — "pokemn" for "pokemon", "toystroy" for "toy story" — should
// still find its match. matchTier() alone requires an exact substring, which
// a typo breaks. Slide a window the length of the query across the title
// (word-aligned, so "toy stor" is compared against "toy story" and against
// "story 2", not some arbitrary character offset) and accept if any window
// is within the typo budget for the query's length.
export function fuzzyMatches(title: string, query: string): boolean {
  const q = normalize(query);
  const words = normalize(title).split(/\s+/);
  const budget = typoBudget(q.length);

  for (let start = 0; start < words.length; start++) {
    let window = "";
    for (let end = start; end < words.length; end++) {
      window = window ? `${window} ${words[end]}` : words[end];
      if (window.length > q.length + budget) break; // window's grown too far past query length
      if (Math.abs(window.length - q.length) > budget) continue;
      if (levenshtein(window, q) <= budget) return true;
    }
  }
  return false;
}

// fuzzyMatches() only re-ranks candidates a source ALREADY returned — verified
// live that this isn't enough on its own: TMDB's own search has some built-in
// typo tolerance ("harry poter" already finds Harry Potter with no changes
// here), but IGDB and MangaDex return literally ZERO raw candidates for a
// misspelled query ("pokemn" for "pokemon") — there's nothing to re-rank.
// Real correction needs to retry the search itself with a plausible fix.

// Single-transposition candidates of `s` (adjacent-character swaps).
function transpositionsOf(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] !== s[i + 1]) out.push(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
  }
  return out;
}

// Generates likely single-typo corrections: adjacent-letter swap (fat-finger),
// single-character deletion (an accidentally doubled letter), single-vowel
// insertion (the most common omission), and single-space insertion — verified
// live that this last one matters: TMDB tolerates "harry poter" (missing
// letter, word boundaries intact) but NOT "toystroy" for "toy story" (missing
// SPACE) even though it's arguably a smaller edit. The caller (see
// findTypoMatch in lib/sources/index.ts) is bounded by a real TIME budget,
// not by this list's length, so `max` just needs to be generous enough that
// the rarer compound fixes (see the space+transposition chaining below)
// aren't truncated away before ever being generated — verified live that an
// 80-item cap cut the list off BEFORE reaching "toy story", silently
// breaking that case despite the compound-generation code being correct.
export function typoVariants(query: string, max = 250): string[] {
  const q = query.trim().toLowerCase();
  const variants: string[] = [];
  const seen = new Set([q]);
  const add = (v: string) => {
    if (!seen.has(v)) {
      seen.add(v);
      variants.push(v);
    }
  };

  // Ordered by how common the typo type is AND how cheap the correction is
  // to generate — cheap, common single-edit fixes first, so a source with a
  // real rate limit (IGDB, ~4 req/sec — see lib/sources/igdb.ts) finds the
  // answer in its first few throttled requests rather than its fiftieth.
  for (const v of transpositionsOf(q)) add(v);
  for (let i = 0; i < q.length; i++) {
    add(q.slice(0, i) + q.slice(i + 1));
  }
  for (let i = 0; i <= q.length; i++) {
    for (const v of ["a", "e", "i", "o", "u"]) {
      add(q.slice(0, i) + v + q.slice(i));
    }
  }
  const spaceInserted: string[] = [];
  for (let i = 1; i < q.length; i++) {
    if (q[i] !== " " && q[i - 1] !== " ") {
      const v = `${q.slice(0, i)} ${q.slice(i)}`;
      add(v);
      spaceInserted.push(v);
    }
  }
  // Two words run together AND scrambled at the same time — e.g. "toystroy"
  // for "toy story" — needs BOTH a space inserted AND a transposition fixed.
  // Neither single-edit correction alone finds anything on its own (verified
  // live: TMDB returns zero raw candidates for both "toystory", transposition
  // fixed but still one run-together word, and "toy stroy", space restored
  // but the letters still scrambled) — only trying single edits of the
  // ORIGINAL query can ever produce the compound fix. Chaining a
  // transposition pass onto each space-inserted candidate covers it without
  // the full-blown cost of transposing every position against every other
  // variant. Placed last: rarest case, and the priciest to generate (adds
  // roughly one more candidate per query character).
  for (const v of spaceInserted) {
    for (const t of transpositionsOf(v)) add(t);
  }

  return variants.slice(0, max);
}
