import UIKit

// SwiftUI apps don't get the APNs token directly — it arrives via this old-style
// app-delegate callback. We bridge it in with @UIApplicationDelegateAdaptor
// (see MediaTrackerApp).
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        true
    }

    // Called by iOS once registerForRemoteNotifications() succeeds.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // The token is raw bytes; APNs expects it as a hex string.
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()

        // Remember it (so follow/unfollow can include it) and register with our backend.
        UserDefaults.standard.set(token, forKey: "apnsToken")
        Task { try? await APIClient().registerDevice(token: token) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("APNs registration failed: \(error)")
    }
}
