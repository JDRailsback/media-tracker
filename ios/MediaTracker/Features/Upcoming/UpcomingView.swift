import SwiftUI
import SwiftData

// A cross-media timeline of future releases among the items you follow.
struct UpcomingView: View {
    @Query private var followed: [FollowedMedia]

    // Followed items with a release date in the future, soonest first.
    private var upcoming: [FollowedMedia] {
        followed
            .filter { ($0.releaseDate ?? .distantPast) >= Date() }
            .sorted { ($0.releaseDate ?? .distantFuture) < ($1.releaseDate ?? .distantFuture) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if upcoming.isEmpty {
                    ContentUnavailableView(
                        "No upcoming releases",
                        systemImage: "calendar",
                        description: Text("Release dates for items you follow will appear here.")
                    )
                } else {
                    List(upcoming) { media in
                        FollowedRow(media: media)
                    }
                }
            }
            .navigationTitle("Upcoming")
        }
    }
}

#Preview {
    UpcomingView()
        .modelContainer(for: FollowedMedia.self, inMemory: true)
}
