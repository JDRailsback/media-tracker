import SwiftUI
import SwiftData

// The pop-up shown when a search result is tapped: poster, info, follow, links.
struct DetailView: View {
    let item: MediaItem

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query private var followed: [FollowedMedia]

    // Full details (with watch links), loaded when the sheet opens.
    @State private var detailed: MediaItem?

    private let api = APIClient()

    // Show the detailed version once loaded; fall back to the basic search item.
    private var shownItem: MediaItem { detailed ?? item }

    private var isFollowed: Bool {
        followed.contains { $0.itemID == item.id }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    poster
                    titleBlock
                    followButton

                    if let overview = shownItem.overview, !overview.isEmpty {
                        Text(overview)
                            .font(.body)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    watchLinks
                }
                .padding()
            }
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                // Load full details (incl. watch links) once, when the sheet opens.
                detailed = try? await api.details(for: item)
            }
        }
    }

    private var poster: some View {
        AsyncImage(url: shownItem.posterURL) { image in
            image.resizable().aspectRatio(contentMode: .fit)
        } placeholder: {
            RoundedRectangle(cornerRadius: 12)
                .fill(.gray.opacity(0.2))
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
        }
        .frame(maxWidth: 220)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var titleBlock: some View {
        VStack(spacing: 6) {
            Text(shownItem.title)
                .font(.title)
                .bold()
                .multilineTextAlignment(.center)

            if let subtitle = shownItem.subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let date = shownItem.releaseDate {
                Text(date, format: .dateTime.year().month().day())
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var followButton: some View {
        Button {
            toggleFollow()
        } label: {
            Label(isFollowed ? "Following" : "Follow",
                  systemImage: isFollowed ? "checkmark.circle.fill" : "plus.circle")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(isFollowed ? .gray : .accentColor)
    }

    @ViewBuilder
    private var watchLinks: some View {
        if let links = shownItem.externalLinks, !links.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Available on")
                    .font(.headline)

                ForEach(links) { link in
                    Link(destination: link.url) {
                        Label(link.provider, systemImage: "play.rectangle.fill")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func toggleFollow() {
        if let existing = followed.first(where: { $0.itemID == item.id }) {
            context.delete(existing)                        // unfollow (local)
            NotificationManager.cancelNotification(id: item.id)
            Task { await unfollowOnServer() }
        } else {
            let new = FollowedMedia(                         // follow (local)
                itemID: shownItem.id,
                type: shownItem.type.rawValue,
                title: shownItem.title,
                subtitle: shownItem.subtitle,
                posterURLString: shownItem.posterURL?.absoluteString,
                releaseDate: shownItem.releaseDate
            )
            context.insert(new)
            Task { await followOnServer() }
        }
    }

    // Follow side effects: permission, a local reminder, and backend registration.
    private func followOnServer() async {
        await NotificationManager.requestAuthorization()

        // Local reminder for a known future date (works even without a token).
        if let date = shownItem.releaseDate {
            NotificationManager.scheduleReleaseNotification(
                id: shownItem.id, title: shownItem.title, date: date
            )
        }

        // Tell the backend so its poller can push date *changes* to this device.
        // Best-effort: the APNs token may not have arrived on a very first follow.
        if let token = UserDefaults.standard.string(forKey: "apnsToken") {
            try? await api.follow(itemID: shownItem.id, token: token)
        }
    }

    private func unfollowOnServer() async {
        if let token = UserDefaults.standard.string(forKey: "apnsToken") {
            try? await api.unfollow(itemID: shownItem.id, token: token)
        }
    }
}

#Preview {
    DetailView(item: MediaItem(
        id: "movie:603",
        type: .movie,
        title: "The Matrix",
        subtitle: "1999 · Sci-Fi",
        overview: "A hacker discovers reality is a simulation and joins a rebellion against the machines.",
        posterURL: nil,
        releaseDate: nil,
        externalLinks: nil
    ))
    .modelContainer(for: FollowedMedia.self, inMemory: true)
}
