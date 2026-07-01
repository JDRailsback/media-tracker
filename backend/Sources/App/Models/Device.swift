import Fluent
import Foundation

// A phone registered to receive push notifications, identified by its APNs token.
final class Device: Model, Content {
    static let schema = "devices"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "apns_token")
    var apnsToken: String

    @Field(key: "platform")
    var platform: String            // "ios"

    // @Timestamp with on: .update auto-sets this whenever the row is saved.
    @Timestamp(key: "updated_at", on: .update)
    var updatedAt: Date?

    init() {}

    init(apnsToken: String, platform: String = "ios") {
        self.apnsToken = apnsToken
        self.platform = platform
    }
}
