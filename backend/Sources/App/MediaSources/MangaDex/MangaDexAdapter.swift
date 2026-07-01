import Vapor

// Talks to MangaDex (api.mangadex.org) and maps results into our MediaItem.
// v1 tracks OFFICIAL English chapter dates only (see docs/MANGA_TRACKING.md):
// details() reads the next scheduled official chapter's date.
struct MangaDexAdapter: MediaSource {
    let mediaType: MediaType = .manga

    func search(_ query: String, client: Client) async throws -> [MediaItem] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let url: URI = "https://api.mangadex.org/manga?title=\(encoded)&limit=10&includes[]=cover_art"

        let response = try await client.get(url)
        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "MangaDex search failed: \(response.status)")
        }

        let payload = try response.content.decode(MangaDexSearchResponse.self)
        return payload.data.map { map($0) }
    }

    func details(id: String, client: Client) async throws -> MediaItem {
        // 1. Fetch the manga itself (with cover art).
        let mangaURL: URI = "https://api.mangadex.org/manga/\(id)?includes[]=cover_art"
        let mangaResponse = try await client.get(mangaURL)
        guard mangaResponse.status == .ok else {
            throw Abort(.badGateway, reason: "MangaDex details failed: \(mangaResponse.status)")
        }
        var item = map(try mangaResponse.content.decode(MangaDexEntityResponse.self).data)

        // 2. Find the next scheduled OFFICIAL chapter and use its date.
        if let next = try await nextOfficialChapter(mangaID: id, client: client) {
            item.releaseDate = next.date
            item.subtitle = "Ch. \(next.chapter)"
        }
        return item
    }

    // MARK: - Next official chapter

    private func nextOfficialChapter(
        mangaID: String,
        client: Client
    ) async throws -> (chapter: String, date: Date)? {
        // includeExternalUrl=1 -> official chapters; includeFuturePublishAt=1 ->
        // chapters scheduled in the future; asc order -> earliest first.
        let url: URI = "https://api.mangadex.org/manga/\(mangaID)/feed?translatedLanguage[]=en&order[publishAt]=asc&includeExternalUrl=1&includeFuturePublishAt=1&limit=100"

        let response = try await client.get(url)
        guard response.status == .ok else { return nil }
        let feed = try response.content.decode(MangaDexFeedResponse.self)

        let formatter = ISO8601DateFormatter()
        let now = Date()

        for chapter in feed.data {
            // Official chapters are the ones with an external (Manga Plus/VIZ) link.
            guard let external = chapter.attributes.externalUrl, !external.isEmpty else { continue }
            guard let date = formatter.date(from: chapter.attributes.publishAt) else { continue }
            if date > now {
                return (chapter.attributes.chapter ?? "?", date)
            }
        }
        return nil   // nothing scheduled ahead
    }

    // MARK: - Mapping (MangaDex shape -> our shape)

    private func map(_ manga: MangaDexManga) -> MediaItem {
        // title is localized; prefer English, else any available, else a fallback.
        let title = manga.attributes.title["en"]
            ?? manga.attributes.title.values.first
            ?? "Untitled"

        return MediaItem(
            id: "manga:\(manga.id)",
            type: .manga,
            title: title,
            subtitle: manga.attributes.year.map { String($0) },
            overview: manga.attributes.description?["en"],
            posterURL: coverURL(mangaID: manga.id, relationships: manga.relationships),
            releaseDate: nil
        )
    }

    private func coverURL(mangaID: String, relationships: [MangaDexRelationship]) -> URL? {
        guard let cover = relationships.first(where: { $0.type == "cover_art" }),
              let fileName = cover.attributes?.fileName else {
            return nil
        }
        return URL(string: "https://uploads.mangadex.org/covers/\(mangaID)/\(fileName).512.jpg")
    }
}
