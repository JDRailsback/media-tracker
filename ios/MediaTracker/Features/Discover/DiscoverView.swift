import SwiftUI

// The search screen. Type a query, hit return, see results from the backend.
struct DiscoverView: View {
    // @State: SwiftUI watches these; changing them re-renders the view.
    @State private var query = ""
    @State private var results: [MediaItem] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    // Which item's detail sheet is open. nil = no sheet.
    @State private var selectedItem: MediaItem?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            List(results) { item in
                Button {
                    selectedItem = item
                } label: {
                    MediaRow(item: item)
                }
                .buttonStyle(.plain)
            }
            // Presents DetailView whenever `selectedItem` becomes non-nil.
            .sheet(item: $selectedItem) { item in
                DetailView(item: item)
            }
            .overlay {
                // Show different content depending on state.
                if isSearching {
                    ProgressView()
                } else if results.isEmpty {
                    ContentUnavailableView(
                        "Search for media",
                        systemImage: "magnifyingglass",
                        description: Text("Find movies, shows, and games to track.")
                    )
                }
            }
            .navigationTitle("Discover")
            // Adds the system search bar, two-way bound to `query`.
            .searchable(text: $query, prompt: "Movies, shows, games…")
            // Runs when the user submits the search (taps return).
            .onSubmit(of: .search) {
                Task { await runSearch() }
            }
            .alert("Search failed", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private func runSearch() async {
        // Ignore empty/whitespace queries.
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }

        isSearching = true
        defer { isSearching = false }   // always reset, even if an error is thrown

        do {
            results = try await api.search(query: query)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// One row in the results list: poster thumbnail + title + subtitle.
struct MediaRow: View {
    let item: MediaItem

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: item.posterURL) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Color.gray.opacity(0.2)
            }
            .frame(width: 50, height: 75)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.headline)
                if let subtitle = item.subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

#Preview {
    DiscoverView()
}
