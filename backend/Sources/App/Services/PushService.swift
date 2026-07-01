import Vapor
import APNS
import VaporAPNS
import APNSCore

// The seam that isolates all APNs-library specifics from the rest of the app.
// The poller (and anything else) calls sendReleaseAlert(...); only THIS file
// knows how APNs actually works. If the APNs API changes, only this changes.
struct PushService {
    let app: Application

    // The app's bundle id (APNs "topic").
    private var topic: String {
        Environment.get("APNS_TOPIC") ?? "com.example.mediatracker"
    }

    // Send a simple title/body alert to one device token.
    // VERIFY-ON-MAC: exact APNSAlertNotification / send API is version-sensitive.
    func sendReleaseAlert(title: String, body: String, to deviceToken: String) async throws {
        let alert = APNSAlertNotification(
            alert: .init(
                title: .raw(title),
                body: .raw(body)
            ),
            expiration: .immediately,
            priority: .immediately,
            topic: topic,
            payload: EmptyPayload()
        )
        try await app.apns.client.sendAlertNotification(alert, deviceToken: deviceToken)
    }
}

// APNs payloads must be Encodable; we don't attach custom data yet.
struct EmptyPayload: Codable {}
