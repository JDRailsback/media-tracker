import SwiftUI

// A row showing a followed item. Shared by the Library and Upcoming tabs.
struct FollowedRow: View {
    let media: FollowedMedia

    // Rebuild a URL from the stored string (nil if absent/invalid).
    private var posterURL: URL? {
        media.posterURLString.flatMap { URL(string: $0) }
    }

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: posterURL) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Color.gray.opacity(0.2)
            }
            .frame(width: 50, height: 75)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                Text(media.title)
                    .font(.headline)
                if let subtitle = media.subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let date = media.releaseDate {
                    Text(date, format: .dateTime.year().month().day())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
