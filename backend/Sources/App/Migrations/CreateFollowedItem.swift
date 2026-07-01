import Fluent

// Creates the followed_items table. AsyncMigration = the async/await flavor.
struct CreateFollowedItem: AsyncMigration {
    // prepare() applies the change (build the table).
    func prepare(on database: Database) async throws {
        try await database.schema("followed_items")
            .id()                                              // UUID primary key
            .field("item_id", .string, .required)
            .field("type", .string, .required)
            .field("source_id", .string, .required)
            .field("last_known_release_date", .datetime)
            .field("last_known_status", .string)
            .field("last_checked_at", .datetime)
            .unique(on: "item_id")                             // one row per item
            .create()
    }

    // revert() undoes it (drop the table) — used when rolling a migration back.
    func revert(on database: Database) async throws {
        try await database.schema("followed_items").delete()
    }
}
