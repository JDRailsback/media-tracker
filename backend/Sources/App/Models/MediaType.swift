import Foundation

// The kind of media an item represents.
// More cases (book, comic, album, ...) will be added in later phases.
enum MediaType: String, Codable {
    case movie
    case tvShow
    case game
    case manga
}
