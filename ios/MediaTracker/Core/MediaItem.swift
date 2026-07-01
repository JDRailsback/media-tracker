import Foundation

// Client-side mirror of the backend's MediaType. Must match the JSON the
// backend sends ("movie", "tvShow", "game").
enum MediaType: String, Codable {
    case movie
    case tvShow
    case game
    case manga
}

// Where you can watch/play an item, and what kind of link it is.
enum LinkKind: String, Codable {
    case stream
    case rent
    case buy
    case store
    case info
}

// One "available on" entry (e.g. Netflix, Steam) with a link out.
struct ExternalLink: Codable, Identifiable {
    let provider: String
    let logoURL: URL?
    let url: URL
    let kind: LinkKind

    // A stable id for ForEach. Computed, so it isn't part of the JSON.
    var id: String { provider + url.absoluteString }
}

// Client-side mirror of the backend's MediaItem. We DECODE the backend's JSON
// into this. Codable handles the decoding; Identifiable lets List track rows.
struct MediaItem: Codable, Identifiable {
    let id: String          // "movie:603"
    let type: MediaType
    let title: String
    let subtitle: String?
    let overview: String?
    let posterURL: URL?
    let releaseDate: Date?
    // Optional: if the backend omits this key, it decodes to nil (no error).
    let externalLinks: [ExternalLink]?
}
