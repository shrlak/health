import Foundation
import SwiftUI

/// The payload `whoop-widget` returns. The field names match the JSON exactly,
/// so no key mapping is needed; anything Whoop has not scored yet arrives null
/// and stays optional all the way to the view, which draws a dash for it.
struct TrendPoint: Decodable, Hashable {
    let day: String
    let value: Double
}

struct Summary: Decodable {
    let day: String?
    let recovery: Double?
    let hrv: Double?
    let restingHr: Double?
    let strain: Double?
    let sleepMin: Double?
    let sleepNeedMin: Double?
    let sleepPerformance: Double?
    let recoveryTrend: [TrendPoint]
    let strainTrend: [TrendPoint]
    let updatedAt: String
}

enum SummaryError: LocalizedError {
    case notConfigured
    case badURL
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Add your token in Config.swift"
        case .badURL: return "The endpoint in Config.swift is not a URL"
        case .http(401): return "Token rejected"
        case .http(let code): return "Server said \(code)"
        }
    }
}

func fetchSummary() async throws -> Summary {
    guard !Config.token.isEmpty, !Config.token.hasPrefix("PASTE_") else {
        throw SummaryError.notConfigured
    }
    guard let url = URL(string: Config.endpoint) else { throw SummaryError.badURL }

    var request = URLRequest(url: url)
    request.setValue("Bearer \(Config.token)", forHTTPHeaderField: "Authorization")
    // A widget that redraws a cached body has no way to show it is stale, so
    // every refresh goes to the network.
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 20

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw SummaryError.http(0) }
    guard http.statusCode == 200 else { throw SummaryError.http(http.statusCode) }
    return try JSONDecoder().decode(Summary.self, from: data)
}

// MARK: - Display

extension Summary {
    var recoveryText: String { recovery.map { "\(Int($0.rounded()))%" } ?? "—" }
    var strainText: String { strain.map { String(format: "%.1f", $0) } ?? "—" }
    var hrvText: String { hrv.map { "\(Int($0.rounded())) ms" } ?? "—" }
    var restingHrText: String { restingHr.map { "\(Int($0.rounded())) bpm" } ?? "—" }

    var sleepText: String {
        guard let minutes = sleepMin else { return "—" }
        let total = Int(minutes.rounded())
        return "\(total / 60)h \(total % 60)m"
    }

    var sleepDetail: String {
        guard let performance = sleepPerformance else { return "Sleep" }
        return "Sleep · \(Int(performance.rounded()))% of need"
    }

    /// 0…1, for the ring. Nothing scored yet leaves it empty rather than full.
    var recoveryFraction: Double {
        guard let recovery else { return 0 }
        return min(max(recovery / 100, 0), 1)
    }

    /// Whoop's own bands: green from 67, yellow from 34, red below that.
    var recoveryColor: Color {
        guard let recovery else { return .secondary }
        if recovery >= 67 { return Color(red: 0.06, green: 0.73, blue: 0.51) }
        if recovery >= 34 { return Color(red: 1.00, green: 0.73, blue: 0.09) }
        return Color(red: 0.98, green: 0.31, blue: 0.35)
    }

    /// "Mon 14 Sep", or nothing if no day has been scored yet.
    var dayText: String {
        guard let day else { return "No data yet" }
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = parser.date(from: day) else { return day }

        let display = DateFormatter()
        display.dateFormat = "EEE d MMM"
        display.timeZone = TimeZone(secondsFromGMT: 0)
        return display.string(from: date)
    }
}
