import Vapor

// Request bodies the app sends to the follow/device endpoints. Content lets
// Vapor DECODE them from the incoming JSON request body.

struct FollowRequest: Content {
    let itemID: String      // canonical id, e.g. "movie:603"
    let apnsToken: String    // which device is following/unfollowing
}

struct DeviceRequest: Content {
    let apnsToken: String
    let platform: String?
}
