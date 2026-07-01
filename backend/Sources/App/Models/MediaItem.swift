import Vapor

// The clean, uniform shape every media source maps into.
// This is a TRIMMED first version: it holds the common fields shared by all
// media types. Type-specific extras (the `payload` from DATA_MODEL.md) and
// release-date lists will be added incrementally later.
struct MediaItem: Content {
    var id: String          // our canonical id, e.g. "movie:603"
    var type: MediaType
    var title: String
    var subtitle: String?   // optional: may be missing
    var overview: String?
    var posterURL: URL?
    var releaseDate: Date?
    // "Available on" links. Defaults to empty so existing code (e.g. search,
    // which doesn't fetch providers) keeps compiling without specifying it.
    var externalLinks: [ExternalLink] = []
}
