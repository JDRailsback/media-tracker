import Vapor

// What kind of link this is (matches the client's LinkKind).
enum LinkKind: String, Content {
    case stream
    case rent
    case buy
    case store
    case info
}

// One "available on" entry: where you can watch/play an item, and a link out.
struct ExternalLink: Content {
    var provider: String
    var logoURL: URL?
    var url: URL
    var kind: LinkKind
}
