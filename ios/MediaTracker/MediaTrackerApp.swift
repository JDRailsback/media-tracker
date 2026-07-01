import SwiftUI
import SwiftData

// The entry point of the iOS app (the SwiftUI equivalent of a `main` function).
@main
struct MediaTrackerApp: App {
    // Bridges in an app delegate so we can receive the APNs device token.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        // Sets up the local SwiftData database for FollowedMedia and injects it
        // into the view hierarchy so @Query and @Environment(\.modelContext) work.
        .modelContainer(for: FollowedMedia.self)
    }
}
