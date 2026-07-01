import Fluent

struct CreateDevice: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("devices")
            .id()
            .field("apns_token", .string, .required)
            .field("platform", .string, .required)
            .field("updated_at", .datetime)
            .unique(on: "apns_token")       // one row per device token
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("devices").delete()
    }
}
