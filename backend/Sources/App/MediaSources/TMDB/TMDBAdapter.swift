import Vapor

// Talks to TMDB and maps its responses into our MediaItem shape.
// Conforms to MediaSource, so the rest of the app can use it without knowing
// anything about TMDB specifically.
struct TMDBAdapter: MediaSource {
    let mediaType: MediaType = .movie

    // The TMDB API key. Injected in (read from the environment) so the secret
    // never lives in source code.
    let apiKey: String

    func search(_ query: String, client: Client) async throws -> [MediaItem] {
        // Percent-encode the user's query so it's safe inside a URL.
        let encodedQuery = query.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? query

        // Build the TMDB search URL.
        let url: URI = "https://api.themoviedb.org/3/search/movie?api_key=\(apiKey)&query=\(encodedQuery)"

        // Make the outbound GET request and wait for the response.
        let response = try await client.get(url)

        // If TMDB didn't return 200 OK, fail with a clear error.
        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "TMDB request failed: \(response.status)")
        }

        // Decode TMDB's JSON into our DTOs, then map each hit to a MediaItem.
        let payload = try response.content.decode(TMDBSearchResponse.self)
        return payload.results.map { movie in
            map(movie)
        }
    }

    // Fetch one movie's full details, including watch providers, in a single
    // request via TMDB's "append_to_response" feature.
    func details(id: String, client: Client) async throws -> MediaItem {
        guard let tmdbID = Int(id) else {
            throw Abort(.badRequest, reason: "Invalid TMDB id: \(id)")
        }
        let url: URI = "https://api.themoviedb.org/3/movie/\(tmdbID)?api_key=\(apiKey)&append_to_response=watch/providers"

        let response = try await client.get(url)
        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "TMDB details request failed: \(response.status)")
        }

        let detail = try response.content.decode(TMDBMovieDetail.self)
        return map(detail)
    }

    // MARK: - Mapping (TMDB shape -> our shape)

    private func map(_ detail: TMDBMovieDetail) -> MediaItem {
        MediaItem(
            id: "movie:\(detail.id)",
            type: .movie,
            title: detail.title,
            subtitle: nil,
            overview: detail.overview,
            posterURL: posterURL(from: detail.posterPath),
            releaseDate: parseDate(detail.releaseDate),
            externalLinks: externalLinks(from: detail.watchProviders)
        )
    }

    // Flatten TMDB's per-country provider lists into our ExternalLink array.
    // We use US providers for now.
    private func externalLinks(from providers: TMDBWatchProviders?) -> [ExternalLink] {
        guard let country = providers?.results["US"],
              let link = country.link,
              let url = URL(string: link) else {
            return []
        }

        var links: [ExternalLink] = []

        // Local helper: append one ExternalLink per provider in a given list.
        func add(_ list: [TMDBProvider]?, kind: LinkKind) {
            guard let list else { return }
            for provider in list {
                links.append(ExternalLink(
                    provider: provider.providerName,
                    logoURL: logoURL(from: provider.logoPath),
                    url: url,
                    kind: kind
                ))
            }
        }

        add(country.flatrate, kind: .stream)
        add(country.rent, kind: .rent)
        add(country.buy, kind: .buy)
        return links
    }

    private func logoURL(from path: String?) -> URL? {
        guard let path else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w92\(path)")
    }

    private func map(_ movie: TMDBMovie) -> MediaItem {
        MediaItem(
            id: "movie:\(movie.id)",
            type: .movie,
            title: movie.title,
            subtitle: nil,
            overview: movie.overview,
            posterURL: posterURL(from: movie.posterPath),
            releaseDate: parseDate(movie.releaseDate)
        )
    }

    // TMDB gives a partial path like "/abc.jpg"; prepend the image base URL.
    private func posterURL(from path: String?) -> URL? {
        guard let path else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w500\(path)")
    }

    // TMDB sends dates as "yyyy-MM-dd" strings; turn them into real Dates.
    private func parseDate(_ string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: string)
    }
}
