import Foundation

// Talks to OUR backend (never to TMDB/IGDB directly).
struct APIClient {
    // Base URL of the backend. "localhost" works from the iOS Simulator because
    // it shares the Mac's network. On a real device you'd use the Mac's LAN IP.
    var baseURL = URL(string: "http://localhost:8080")!

    func search(query: String) async throws -> [MediaItem] {
        // Build the URL: <base>/search?q=<query>
        var components = URLComponents(
            url: baseURL.appendingPathComponent("search"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        let url = components.url!

        // Make the request and wait for the response.
        let (data, response) = try await URLSession.shared.data(from: url)

        // Make sure we got HTTP 200 OK.
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        // Decode the JSON array into our MediaItem array.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([MediaItem].self, from: data)
    }

    // Fetch one item's full details (incl. watch links) from /item/{type}/{id}.
    func details(for item: MediaItem) async throws -> MediaItem {
        // item.id looks like "movie:603" -> path components "movie" and "603".
        let parts = item.id.split(separator: ":")
        guard parts.count == 2 else { throw URLError(.badURL) }

        let url = baseURL
            .appendingPathComponent("item")
            .appendingPathComponent(String(parts[0]))
            .appendingPathComponent(String(parts[1]))

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(MediaItem.self, from: data)
    }

    // MARK: - Follow / device (POST)

    func registerDevice(token: String) async throws {
        try await post("device", body: ["apnsToken": token, "platform": "ios"])
    }

    func follow(itemID: String, token: String) async throws {
        try await post("follow", body: ["itemID": itemID, "apnsToken": token])
    }

    func unfollow(itemID: String, token: String) async throws {
        try await post("unfollow", body: ["itemID": itemID, "apnsToken": token])
    }

    // Shared helper: POST a small JSON body, expect a 2xx with no body to read.
    private func post(_ path: String, body: [String: String]) async throws {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
