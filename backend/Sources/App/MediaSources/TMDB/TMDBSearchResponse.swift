import Vapor

// Mirrors the JSON that TMDB returns from its movie-search endpoint.
// These types exist ONLY to decode TMDB's response; they are never sent to our
// app. The TMDBAdapter maps them into our own MediaItem.
//
// Example TMDB response (trimmed):
// {
//   "page": 1,
//   "results": [
//     { "id": 603, "title": "The Matrix", "overview": "...",
//       "poster_path": "/abc.jpg", "release_date": "1999-03-31" }
//   ]
// }

struct TMDBSearchResponse: Content {
    let results: [TMDBMovie]
}

struct TMDBMovie: Content {
    let id: Int
    let title: String
    let overview: String?
    let posterPath: String?
    let releaseDate: String?

    // TMDB uses snake_case keys; Swift uses camelCase. CodingKeys maps between
    // the two: our property name on the left, TMDB's JSON key on the right.
    enum CodingKeys: String, CodingKey {
        case id
        case title
        case overview
        case posterPath = "poster_path"
        case releaseDate = "release_date"
    }
}
