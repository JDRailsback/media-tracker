import Vapor

// Talks to IGDB (Twitch's game database) and maps results into our MediaItem.
// Conforms to MediaSource, exactly like TMDBAdapter — same contract, second source.
struct IGDBAdapter: MediaSource {
    let mediaType: MediaType = .game

    // IGDB auth uses a Twitch app's client id + secret (read from the environment).
    let clientID: String
    let clientSecret: String

    func search(_ query: String, client: Client) async throws -> [MediaItem] {
        // 1. Get a fresh OAuth access token from Twitch.
        let token = try await fetchAccessToken(client: client)

        // 2. Search IGDB. The query language ("Apicalypse") goes in the POST body.
        let body = """
        search "\(query)"; fields name,summary,cover.url,first_release_date; limit 20;
        """
        let response = try await client.post("https://api.igdb.com/v4/games") { req in
            req.headers.add(name: "Client-ID", value: clientID)
            req.headers.bearerAuthorization = BearerAuthorization(token: token)
            req.body = ByteBuffer(string: body)
        }

        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "IGDB request failed: \(response.status)")
        }

        // 3. IGDB returns a bare JSON array of games. Decode and map.
        let games = try response.content.decode([IGDBGame].self)
        return games.map { map($0) }
    }

    func details(id: String, client: Client) async throws -> MediaItem {
        guard let gameID = Int(id) else {
            throw Abort(.badRequest, reason: "Invalid IGDB id: \(id)")
        }
        let token = try await fetchAccessToken(client: client)

        // Same endpoint as search, but filtered to one specific game id.
        let body = "fields name,summary,cover.url,first_release_date; where id = \(gameID);"
        let response = try await client.post("https://api.igdb.com/v4/games") { req in
            req.headers.add(name: "Client-ID", value: clientID)
            req.headers.bearerAuthorization = BearerAuthorization(token: token)
            req.body = ByteBuffer(string: body)
        }

        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "IGDB details request failed: \(response.status)")
        }

        let games = try response.content.decode([IGDBGame].self)
        guard let game = games.first else {
            throw Abort(.notFound, reason: "Game \(id) not found")
        }
        return map(game)
    }

    // MARK: - Auth

    private func fetchAccessToken(client: Client) async throws -> String {
        let url: URI = "https://id.twitch.tv/oauth2/token?client_id=\(clientID)&client_secret=\(clientSecret)&grant_type=client_credentials"
        let response = try await client.post(url)

        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "IGDB auth failed: \(response.status)")
        }

        return try response.content.decode(IGDBTokenResponse.self).accessToken
    }

    // MARK: - Mapping (IGDB shape -> our shape)

    private func map(_ game: IGDBGame) -> MediaItem {
        MediaItem(
            id: "game:\(game.id)",
            type: .game,
            title: game.name,
            subtitle: nil,
            overview: game.summary,
            posterURL: coverURL(from: game.cover?.url),
            releaseDate: parseDate(game.firstReleaseDate)
        )
    }

    // IGDB returns "//images.igdb.com/.../t_thumb/abc.jpg": add a scheme and
    // bump the tiny thumbnail to a larger cover size.
    private func coverURL(from raw: String?) -> URL? {
        guard let raw else { return nil }
        let bigger = raw.replacingOccurrences(of: "t_thumb", with: "t_cover_big")
        let full = bigger.hasPrefix("//") ? "https:\(bigger)" : bigger
        return URL(string: full)
    }

    // IGDB sends release dates as a Unix timestamp (seconds since 1970).
    private func parseDate(_ timestamp: Int?) -> Date? {
        guard let timestamp else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(timestamp))
    }
}
