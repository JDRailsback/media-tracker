import Vapor
import Fluent

// The heart of the notification system. One pass:
//   1. load every FollowedItem
//   2. re-fetch its current details via the right adapter
//   3. if the release date changed, push to every device following it
//   4. save the new "last known" values
// Runs on a schedule (set up in configure.swift).
struct ReleasePoller {
    let app: Application

    func runOnce() async throws {
        let db = app.db
        let items = try await FollowedItem.query(on: db).all()
        app.logger.info("Poller: checking \(items.count) followed item(s)")

        // Check each item independently so one failure doesn't abort the pass.
        for item in items {
            do {
                try await check(item, on: db)
            } catch {
                app.logger.error("Poller: \(item.itemID) failed: \(error)")
            }
        }
    }

    private func check(_ item: FollowedItem, on db: Database) async throws {
        guard let fetched = try await fetchDetails(type: item.type, sourceID: item.sourceID) else {
            return
        }

        let firstCheck = (item.lastCheckedAt == nil)
        let dateChanged = (fetched.releaseDate != item.lastKnownReleaseDate)

        // Record the latest values.
        item.lastKnownReleaseDate = fetched.releaseDate
        item.lastCheckedAt = Date()
        try await item.save(on: db)

        // Notify only on a genuine change — not the first (baseline) check.
        if !firstCheck, dateChanged, let newDate = fetched.releaseDate {
            try await notifyFollowers(of: item, title: fetched.title, date: newDate, on: db)
        }
    }

    // Re-fetch via the correct adapter, using the app's shared HTTP client and
    // credentials from the environment (there's no Request here).
    private func fetchDetails(type: String, sourceID: String) async throws -> MediaItem? {
        let client = app.client
        switch type {
        case "movie":
            guard let key = Environment.get("TMDB_API_KEY") else { return nil }
            return try await TMDBAdapter(apiKey: key).details(id: sourceID, client: client)
        case "game":
            guard let id = Environment.get("IGDB_CLIENT_ID"),
                  let secret = Environment.get("IGDB_CLIENT_SECRET") else { return nil }
            return try await IGDBAdapter(clientID: id, clientSecret: secret)
                .details(id: sourceID, client: client)
        case "manga":
            return try await MangaDexAdapter().details(id: sourceID, client: client)
        default:
            return nil
        }
    }

    private func notifyFollowers(
        of item: FollowedItem,
        title: String,
        date: Date,
        on db: Database
    ) async throws {
        // Load the links AND their devices in one go (.with = eager-load).
        let follows = try await DeviceFollow.query(on: db)
            .filter(\.$followedItem.$id == item.id!)
            .with(\.$device)
            .all()

        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        let dateText = formatter.string(from: date)

        let push = PushService(app: app)
        for follow in follows {
            do {
                try await push.sendReleaseAlert(
                    title: "New release date",
                    body: "\(title) — now releasing \(dateText)",
                    to: follow.device.apnsToken
                )
            } catch {
                // One bad/expired token shouldn't stop the others.
                app.logger.error("Poller: push failed: \(error)")
            }
        }
    }
}
