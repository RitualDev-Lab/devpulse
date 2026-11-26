import Foundation

public struct DevPulseBreadcrumb: Codable, Sendable {
    public let timestamp: Int
    public let category: String
    public let level: String
    public let message: String
}

public final class DevPulseSwift {
    public static let shared = DevPulseSwift()
    private var apiKey = ""
    private var endpoint = "https://devpulse.ritualdev.in"
    private var release: String?
    private var scrubPii = true
    private var breadcrumbs: [DevPulseBreadcrumb] = []
    private let lock = NSLock()

    public func configure(apiKey: String, endpoint: String = "https://devpulse.ritualdev.in", release: String? = nil, scrubPii: Bool = true) {
        self.apiKey = apiKey
        self.endpoint = endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.release = release
        self.scrubPii = scrubPii
        NSSetUncaughtExceptionHandler { exception in
            DevPulseSwift.shared.captureException(name: exception.name.rawValue, message: exception.reason ?? "Uncaught NSException", stack: exception.callStackSymbols.joined(separator: "\n"))
        }
    }

    public func addBreadcrumb(category: String, level: String = "info", message: String) {
        lock.lock()
        defer { lock.unlock() }
        let msg = scrubPii ? Self.redactPii(message) : message
        breadcrumbs.append(DevPulseBreadcrumb(timestamp: Int(Date().timeIntervalSince1970), category: category, level: level, message: msg))
        if breadcrumbs.count > 40 { breadcrumbs.removeFirst() }
    }

    public func captureException(name: String, message: String, stack: String) {
        let cleanMsg = scrubPii ? Self.redactPii(message) : message
        let cleanStack = scrubPii ? Self.redactPii(stack) : stack
        let payload: [String: Any] = [
            "apiKey": apiKey,
            "errorName": name,
            "message": cleanMsg,
            "stackTrace": cleanStack,
            "runtime": "swift",
            "version": release ?? "1.0.0",
        ]
        send(path: "/api/v1/event", body: payload)
    }

    public func trackMetric(_ metricName: String, value: Double) {
        send(path: "/api/v1/analytics", body: ["project": apiKey, "metricName": metricName, "metricValue": value, "sourceType": "mobile"])
    }

    public static func redactPii(_ input: String) -> String {
        let pattern = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
        return input.replacingOccurrences(of: pattern, with: "[REDACTED_EMAIL]", options: .regularExpression)
    }

    private func send(path: String, body: [String: Any]) {
        guard let url = URL(string: endpoint + path), let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }
}
