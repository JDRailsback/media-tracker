import Vapor

@main
struct Entrypoint {
    static func main() async throws {
        // 1. Figure out which environment we're running in (development, production, ...).
        let env = try Environment.detect()

        // 2. Create the Vapor application itself.
        let app = try await Application.make(env)

        // 3. Configure it (routes, database, etc.). Defined in configure.swift.
        try await configure(app)

        // 4. Start the server and keep it running until stopped.
        try await app.execute()

        // 5. Shut down cleanly when execution ends.
        try await app.asyncShutdown()
    }
}
