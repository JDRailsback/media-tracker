import SwiftUI

// The root view: a tab bar with the app's four main sections.
struct ContentView: View {
    var body: some View {
        TabView {
            DiscoverView()
                .tabItem { Label("Discover", systemImage: "magnifyingglass") }

            LibraryView()
                .tabItem { Label("Library", systemImage: "square.stack") }

            UpcomingView()
                .tabItem { Label("Upcoming", systemImage: "calendar") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

#Preview {
    ContentView()
}
