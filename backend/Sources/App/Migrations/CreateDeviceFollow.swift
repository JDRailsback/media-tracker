import Fluent

struct CreateDeviceFollow: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("device_follows")
            .id()
            // Foreign keys. onDelete: .cascade -> if a device or item is deleted,
            // its link rows are removed automatically.
            .field("device_id", .uuid, .required,
                   .references("devices", "id", onDelete: .cascade))
            .field("followed_item_id", .uuid, .required,
                   .references("followed_items", "id", onDelete: .cascade))
            // A device can't follow the same item twice.
            .unique(on: "device_id", "followed_item_id")
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("device_follows").delete()
    }
}
