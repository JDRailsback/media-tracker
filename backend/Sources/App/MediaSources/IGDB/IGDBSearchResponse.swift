import Vapor

// Mirrors the JSON IGDB (and Twitch's auth server) return.
// Decode-only DTOs; the IGDBAdapter maps IGDBGame into our MediaItem.

// Twitch's OAuth token response (used to authenticate IGDB calls).
struct IGDBTokenResponse: Content {
    let accessToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
    }
}

// One game returned by IGDB's /games endpoint.
struct IGDBGame: Content {
    let id: Int
    let name: String
    let summary: String?
    let cover: IGDBCover?
    let firstReleaseDate: Int?   // Unix timestamp in SECONDS

    enum CodingKeys: String, CodingKey {
        case id, name, summary, cover
        case firstReleaseDate = "first_release_date"
    }
}

// IGDB nests the cover image as its own object.
struct IGDBCover: Content {
    let url: String?
}
