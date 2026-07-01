import Foundation
import UserNotifications
import UIKit

// Handles the phone's own (local) notifications and permission.
enum NotificationManager {
    // Ask permission; if granted, also register for remote (APNs) pushes.
    @discardableResult
    static func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                // registerForRemoteNotifications must run on the main thread; the
                // token comes back in AppDelegate.
                await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
            }
            return granted
        } catch {
            return false
        }
    }

    // Schedule a LOCAL notification for a known upcoming release date.
    // Used for dates the phone already knows; the backend push handles date *changes*.
    static func scheduleReleaseNotification(id: String, title: String, date: Date) {
        guard date > Date() else { return }   // don't schedule past dates

        let content = UNMutableNotificationContent()
        content.title = "Out now"
        content.body = title
        content.sound = .default

        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute], from: date
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)

        // Use the item's id as the request id, so we can cancel it on unfollow.
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    static func cancelNotification(id: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
    }
}
