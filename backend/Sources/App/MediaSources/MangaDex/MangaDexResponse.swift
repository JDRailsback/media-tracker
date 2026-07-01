import Vapor

// Mirrors MangaDex's JSON. Decode-only DTOs; the MangaDexAdapter maps these
// into our MediaItem. MangaDex ids are UUID strings.

// A list result (e.g. /manga?title=…).
struct MangaDexSearchResponse: Content {
    let data: [MangaDexManga]
}

// A single-entity result (e.g. /manga/{id}).
struct MangaDexEntityResponse: Content {
    let data: MangaDexManga
}

struct MangaDexManga: Content {
    let id: String
    let attributes: MangaDexMangaAttributes
    let relationships: [MangaDexRelationship]
}

struct MangaDexMangaAttributes: Content {
    // Localized: keys are language codes, e.g. {"en": "One Piece"}.
    let title: [String: String]
    let description: [String: String]?
    let year: Int?
}

// Relationships link a manga to its cover, author, etc. `attributes` is only
// populated for types we request via includes[] (we request cover_art).
struct MangaDexRelationship: Content {
    let id: String
    let type: String
    let attributes: MangaDexRelationshipAttributes?
}

struct MangaDexRelationshipAttributes: Content {
    let fileName: String?   // present on cover_art relationships
}

// Chapter feed (/manga/{id}/feed).
struct MangaDexFeedResponse: Content {
    let data: [MangaDexChapter]
}

struct MangaDexChapter: Content {
    let attributes: MangaDexChapterAttributes
}

struct MangaDexChapterAttributes: Content {
    let chapter: String?        // chapter number as text, e.g. "1187" or "142.5"
    let externalUrl: String?    // set for official (Manga Plus / VIZ) chapters
    let publishAt: String       // ISO-8601; parsed explicitly in the adapter
}
