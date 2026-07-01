// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MediaTrackerBackend",
    platforms: [
        .macOS(.v13)
    ],
    dependencies: [
        // Vapor: the web framework that powers our backend.
        .package(url: "https://github.com/vapor/vapor.git", from: "4.92.0"),
        // Fluent: Vapor's ORM (database layer).
        .package(url: "https://github.com/vapor/fluent.git", from: "4.9.0"),
        // The PostgreSQL driver for Fluent.
        .package(url: "https://github.com/vapor/fluent-postgres-driver.git", from: "2.8.0"),
        // APNs: sending push notifications to iPhones.
        .package(url: "https://github.com/vapor/apns.git", from: "4.0.0"),
    ],
    targets: [
        // The single executable that *is* our backend server.
        .executableTarget(
            name: "App",
            dependencies: [
                .product(name: "Vapor", package: "vapor"),
                .product(name: "Fluent", package: "fluent"),
                .product(name: "FluentPostgresDriver", package: "fluent-postgres-driver"),
                .product(name: "VaporAPNS", package: "apns"),
            ],
            path: "Sources/App"
        ),
    ]
)
