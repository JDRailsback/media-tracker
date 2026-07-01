import Vapor

// The contract every media source (TMDB, IGDB, ...) must fulfill.
// The rest of the app talks to this protocol, never to a specific API.
protocol MediaSource {
    // Which kind of media this source provides.
    var mediaType: MediaType { get }

    // Search the source and return results already mapped into our MediaItem shape.
    // `client` is Vapor's tool for making outbound HTTP requests to the external API.
    func search(_ query: String, client: Client) async throws -> [MediaItem]

    // Fetch one item's full details (including watch links, where available).
    // `id` is the source-specific id as a string (TMDB/IGDB parse an Int from
    // it; MangaDex uses a UUID string directly).
    func details(id: String, client: Client) async throws -> MediaItem
}
