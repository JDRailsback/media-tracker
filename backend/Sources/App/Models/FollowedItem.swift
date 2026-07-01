import Fluent
import Foundation

// The backend's record of an item someone follows — a NOTIFICATION INDEX, not
// the user's library (that lives on the phone in SwiftData). The poller reads
// these to know what to re-check; DeviceFollow (batch 2) links them to devices.
//
// One row per unique item (item_id is unique). Fluent models are classes and
// use property wrappers to map properties to table columns.
final class FollowedItem: Model, Content {
    // The database table name.
    static let schema = "followed_items"

    // Primary key. Optional because it's nil until the row is saved.
    @ID(key: .id)
    var id: UUID?

    @Field(key: "item_id")
    var itemID: String              // canonical id, e.g. "movie:603"

    @Field(key: "type")
    var type: String                // "movie" | "game" | "manga" | ...

    @Field(key: "source_id")
    var sourceID: String            // id within the source API (the part after ":")

    // Last-known values, so the poller can detect changes.
    @OptionalField(key: "last_known_release_date")
    var lastKnownReleaseDate: Date?

    @OptionalField(key: "last_known_status")
    var lastKnownStatus: String?

    @OptionalField(key: "last_checked_at")
    var lastCheckedAt: Date?

    // Fluent requires an empty init.
    init() {}

    // Convenience init for creating new rows.
    init(itemID: String, type: String, sourceID: String) {
        self.itemID = itemID
        self.type = type
        self.sourceID = sourceID
    }
}
