import Vapor

// Mirrors TMDB's movie-details response when we ask for watch providers too,
// via "?append_to_response=watch/providers". Decode-only DTOs.

struct TMDBMovieDetail: Content {
    let id: Int
    let title: String
    let overview: String?
    let posterPath: String?
    let releaseDate: String?
    let watchProviders: TMDBWatchProviders?

    enum CodingKeys: String, CodingKey {
        case id, title, overview
        case posterPath = "poster_path"
        case releaseDate = "release_date"
        case watchProviders = "watch/providers"   // note the slash in TMDB's key
    }
}

struct TMDBWatchProviders: Content {
    // Keyed by country code, e.g. "US", "GB". A dictionary, because the keys
    // are data (countries), not fixed field names.
    let results: [String: TMDBWatchCountry]
}

struct TMDBWatchCountry: Content {
    let link: String?              // a JustWatch page for this title/country
    let flatrate: [TMDBProvider]?  // subscription streaming
    let rent: [TMDBProvider]?
    let buy: [TMDBProvider]?
}

struct TMDBProvider: Content {
    let providerName: String
    let logoPath: String?

    enum CodingKeys: String, CodingKey {
        case providerName = "provider_name"
        case logoPath = "logo_path"
    }
}
