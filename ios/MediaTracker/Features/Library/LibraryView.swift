import SwiftUI
import SwiftData

// Lists the media the user follows, newest first. Backed by local SwiftData.
struct LibraryView: View {
    @Environment(\.modelContext) private var context

    // @Query reads FollowedMedia from the database and auto-updates the view
    // whenever that data changes (follow/unfollow elsewhere reflects instantly).
    @Query(sort: \FollowedMedia.dateFollowed, order: .reverse)
    private var followed: [FollowedMedia]

    var body: some View {
        NavigationStack {
            Group {
                if followed.isEmpty {
                    ContentUnavailableView(
                        "Nothing followed yet",
                        systemImage: "square.stack",
                        description: Text("Items you follow will appear here.")
                    )
                } else {
                    List {
                        ForEach(followed) { media in
                            FollowedRow(media: media)
                        }
                        .onDelete(perform: delete)
                    }
                }
            }
            .navigationTitle("Library")
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            context.delete(followed[index])
        }
    }
}

#Preview {
    LibraryView()
        .modelContainer(for: FollowedMedia.self, inMemory: true)
}
