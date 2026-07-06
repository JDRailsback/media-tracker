import { NextResponse } from "next/server";

// Proxies MangaDex cover images. MangaDex's CDN blocks requests with a normal
// browser User-Agent (and requests with none at all) — so a plain <img src>
// pointed straight at uploads.mangadex.org gets a 400. Fetching it here,
// server-side, with our own descriptive User-Agent works, and the browser
// only ever loads the image from OUR domain.
export async function GET(
  _request: Request,
  { params }: { params: { mangaId: string; fileName: string } }
) {
  const url = `https://uploads.mangadex.org/covers/${params.mangaId}/${params.fileName}`;

  const upstream = await fetch(url, {
    headers: { "User-Agent": "MediaTracker/1.0 (personal project)" },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Cover not found" }, { status: 404 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      // Cache aggressively — cover art for a given manga/file never changes.
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
