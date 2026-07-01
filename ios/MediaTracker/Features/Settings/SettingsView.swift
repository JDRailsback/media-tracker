import SwiftUI

// Placeholder. Will hold notification defaults, per-type toggles, etc.
struct SettingsView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Notifications") {
                    Text("Coming soon")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
}
