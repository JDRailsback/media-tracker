import Vapor
import Fluent
import FluentPostgresDriver
import APNS
import VaporAPNS
import APNSCore
import Crypto

// Called once at startup (from entrypoint.swift) to set up the application.
func configure(_ app: Application) async throws {
    // Connect to Postgres. Hosts (Fly.io, etc.) provide DATABASE_URL; locally we
    // fall back to a sensible default you can override in .env.
    let databaseURL = Environment.get("DATABASE_URL")
        ?? "postgres://mediatracker:mediatracker@localhost:5432/mediatracker"
    try app.databases.use(.postgres(url: databaseURL), as: .psql)

    // Register migrations (schema changes), then run them automatically in dev.
    app.migrations.add(CreateFollowedItem())
    app.migrations.add(CreateDevice())
    app.migrations.add(CreateDeviceFollow())
    if app.environment == .development {
        try await app.autoMigrate()
    }

    // Configure APNs, but only if credentials are present, so the app still
    // boots in dev without push set up.
    // VERIFY-ON-MAC: this API is version-sensitive; adjust to the installed
    // vapor/apns version if it differs.
    if let p8 = Environment.get("APNS_PRIVATE_KEY"),
       let keyID = Environment.get("APNS_KEY_ID"),
       let teamID = Environment.get("APNS_TEAM_ID") {
        let apnsConfig = APNSClientConfiguration(
            authenticationMethod: .jwt(
                privateKey: try .init(pemRepresentation: p8),
                keyIdentifier: keyID,
                teamIdentifier: teamID
            ),
            environment: app.environment == .production ? .production : .sandbox
        )
        app.apns.containers.use(
            apnsConfig,
            eventLoopGroupProvider: .shared(app.eventLoopGroup),
            responseDecoder: JSONDecoder(),
            requestEncoder: JSONEncoder(),
            as: .default
        )
    }

    // Schedule the release-change poller to run periodically (skip in tests).
    // VERIFY-ON-MAC: scheduleRepeatedAsyncTask / makeFutureWithTask signatures.
    if app.environment != .testing {
        app.eventLoopGroup.next().scheduleRepeatedAsyncTask(
            initialDelay: .minutes(1),
            delay: .hours(6)
        ) { _ in
            app.eventLoopGroup.next().makeFutureWithTask {
                do {
                    try await ReleasePoller(app: app).runOnce()
                } catch {
                    app.logger.error("Poller pass failed: \(error)")
                }
            }
        }
    }
    // Encode/decode JSON dates as ISO-8601 strings so the iOS app and the
    // backend agree on date format.
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    ContentConfiguration.global.use(encoder: encoder, for: .json)
    ContentConfiguration.global.use(decoder: decoder, for: .json)

    // Our first route:
    // Respond to a GET request for "/" with a plain-text greeting.
    app.get { req in
        "Media Tracker backend is running."
    }

    // Health check: GET /health -> "OK".
    // A conventional endpoint used to ask "is the server alive?".
    app.get("health") { req in
        "OK"
    }

    // A route that reads input from the URL.
    // GET /greet/Bob  ->  "Hello, Bob!"
    app.get("greet", ":name") { req in
        let name = req.parameters.get("name") ?? "stranger"
        return "Hello, \(name)!"
    }

    // Our first JSON route.
    // GET /sample -> a hardcoded MediaItem, serialized to JSON by Vapor.
    app.get("sample") { req in
        MediaItem(
            id: "movie:603",
            type: .movie,
            title: "The Matrix",
            subtitle: "1999 · Sci-Fi",
            overview: "A hacker discovers reality is a simulation.",
            posterURL: URL(string: "https://image.tmdb.org/t/p/w500/poster.jpg"),
            releaseDate: nil
        )
    }

    // Read source credentials from the environment once at startup.
    let tmdbKey = Environment.get("TMDB_API_KEY") ?? ""
    let igdbClientID = Environment.get("IGDB_CLIENT_ID") ?? ""
    let igdbClientSecret = Environment.get("IGDB_CLIENT_SECRET") ?? ""

    // The real search route.
    //   GET /search?q=matrix             -> searches all sources
    //   GET /search?q=zelda&type=game    -> searches only games (IGDB)
    //   GET /search?q=matrix&type=movie  -> searches only movies (TMDB)
    app.get("search") { req async throws -> [MediaItem] in
        // "q" is required (throws 400 if missing); "type" is optional.
        let query = try req.query.get(String.self, at: "q")
        let type = req.query[String.self, at: "type"]

        let tmdb = TMDBAdapter(apiKey: tmdbKey)
        let igdb = IGDBAdapter(clientID: igdbClientID, clientSecret: igdbClientSecret)
        let mangadex = MangaDexAdapter()

        switch type {
        case "movie":
            return try await tmdb.search(query, client: req.client)
        case "game":
            return try await igdb.search(query, client: req.client)
        case "manga":
            return try await mangadex.search(query, client: req.client)
        default:
            // No type given: search all sources concurrently and combine.
            async let movies = tmdb.search(query, client: req.client)
            async let games = igdb.search(query, client: req.client)
            async let manga = mangadex.search(query, client: req.client)
            return try await movies + games + manga
        }
    }

    // Item details (with watch providers for movies).
    //   GET /item/movie/603
    //   GET /item/game/1942
    app.get("item", ":type", ":id") { req async throws -> MediaItem in
        let type = req.parameters.get("type")
        guard let id = req.parameters.get("id") else {
            throw Abort(.badRequest, reason: "Missing id")
        }

        switch type {
        case "movie":
            return try await TMDBAdapter(apiKey: tmdbKey)
                .details(id: id, client: req.client)
        case "game":
            return try await IGDBAdapter(clientID: igdbClientID, clientSecret: igdbClientSecret)
                .details(id: id, client: req.client)
        case "manga":
            return try await MangaDexAdapter()
                .details(id: id, client: req.client)
        default:
            throw Abort(.notFound, reason: "Unsupported item type")
        }
    }

    // MARK: - Follow / device endpoints (write to Postgres)

    // Register or refresh a device's APNs token.
    // POST /device   { "apnsToken": "...", "platform": "ios" }
    app.post("device") { req async throws -> HTTPStatus in
        let body = try req.content.decode(DeviceRequest.self)

        if let existing = try await Device.query(on: req.db)
            .filter(\.$apnsToken == body.apnsToken)
            .first() {
            existing.platform = body.platform ?? existing.platform
            try await existing.save(on: req.db)
        } else {
            try await Device(apnsToken: body.apnsToken, platform: body.platform ?? "ios")
                .create(on: req.db)
        }
        return .ok
    }

    // Follow an item from a device.
    // POST /follow   { "itemID": "movie:603", "apnsToken": "..." }
    app.post("follow") { req async throws -> HTTPStatus in
        let body = try req.content.decode(FollowRequest.self)

        // itemID is "type:sourceID".
        let parts = body.itemID.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else {
            throw Abort(.badRequest, reason: "Invalid itemID: \(body.itemID)")
        }
        let (type, sourceID) = (parts[0], parts[1])

        // Upsert the device.
        let device = try await Device.query(on: req.db)
            .filter(\.$apnsToken == body.apnsToken)
            .first() ?? Device(apnsToken: body.apnsToken)
        if device.id == nil { try await device.create(on: req.db) }

        // Upsert the followed item.
        let item = try await FollowedItem.query(on: req.db)
            .filter(\.$itemID == body.itemID)
            .first() ?? FollowedItem(itemID: body.itemID, type: type, sourceID: sourceID)
        if item.id == nil { try await item.create(on: req.db) }

        // Link them, unless already linked.
        let alreadyLinked = try await DeviceFollow.query(on: req.db)
            .filter(\.$device.$id == device.id!)
            .filter(\.$followedItem.$id == item.id!)
            .first() != nil
        if !alreadyLinked {
            try await DeviceFollow(deviceID: device.id!, followedItemID: item.id!)
                .create(on: req.db)
        }
        return .ok
    }

    // Unfollow an item from a device.
    // POST /unfollow   { "itemID": "movie:603", "apnsToken": "..." }
    app.post("unfollow") { req async throws -> HTTPStatus in
        let body = try req.content.decode(FollowRequest.self)

        guard
            let device = try await Device.query(on: req.db)
                .filter(\.$apnsToken == body.apnsToken).first(),
            let item = try await FollowedItem.query(on: req.db)
                .filter(\.$itemID == body.itemID).first()
        else {
            return .ok   // nothing to remove
        }

        try await DeviceFollow.query(on: req.db)
            .filter(\.$device.$id == device.id!)
            .filter(\.$followedItem.$id == item.id!)
            .delete()
        return .ok
    }
}
