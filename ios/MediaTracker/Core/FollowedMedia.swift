import Foundation
import SwiftData

// A media item the user follows, saved locally on the phone via SwiftData.
// We store only a small snapshot (enough to render Library + Upcoming offline);
// full details are re-fetched from the backend when a detail sheet opens.
//
// CloudKit-safe (per DATA_MODEL.md): every property is optional or has a
// default, and there are no unique constraints.
@Model
final class FollowedMedia {
    var itemID: String = ""          // canonical id, e.g. "movie:603"
    var type: String = ""            // MediaType raw value, e.g. "movie"
    var title: String = ""
    var subtitle: String?
    var posterURLString: String?     // stored as String; URLs aren't ideal in SwiftData
    var releaseDate: Date?
    var dateFollowed: Date = Date()

    init(
        itemID: String,
        type: String,
        title: String,
        subtitle: String?,
        posterURLString: String?,
        releaseDate: Date?
    ) {
        self.itemID = itemID
        self.type = type
        self.title = title
        self.subtitle = subtitle
        self.posterURLString = posterURLString
        self.releaseDate = releaseDate
        self.dateFollowed = Date()
    }
}
