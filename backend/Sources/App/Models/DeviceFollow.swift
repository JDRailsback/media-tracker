import Fluent
import Foundation

// Join table: which devices follow which items (many-to-many).
// This is what lets the poller push a change to every device following an item.
final class DeviceFollow: Model, Content {
    static let schema = "device_follows"

    @ID(key: .id)
    var id: UUID?

    // @Parent = a foreign-key relationship to another model's row.
    @Parent(key: "device_id")
    var device: Device

    @Parent(key: "followed_item_id")
    var followedItem: FollowedItem

    init() {}

    init(deviceID: UUID, followedItemID: UUID) {
        // The `$` projected value exposes the underlying foreign-key id so we can
        // set it directly without loading the full related row.
        self.$device.id = deviceID
        self.$followedItem.id = followedItemID
    }
}
