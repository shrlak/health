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
    let calories: Double?
    let sleepMin: Double?
    let sleepNeedMin: Double?
    let sleepPerformance: Double?
    let sleepEfficiency: Double?
    /// 0…10, the same blend the dashboard's Insights tab shows.
    let readiness: Double?
    /// "recover" | "pace" | "ready" | "go", or nil alongside a nil `readiness`.
    let readinessBand: String?
    let recoveryTrend: [TrendPoint]
    let strainTrend: [TrendPoint]
    /// Optional, unlike the other two trends: added alongside this decode,
    /// so a widget refreshing before the backend redeploys would otherwise
    /// fail to decode the whole payload over one missing key.
    let hrvTrend: [TrendPoint]?
    let updatedAt: String
}

/// How a metric's latest value compares to the rest of its trend window,
/// mirroring the dashboard's "vs 28-day average" callouts at the widget's
/// much shorter horizon.
struct TrendDelta {
    enum Direction { case up, down, flat }
    let direction: Direction
    let magnitudeText: String

    var symbol: String {
        switch direction {
        case .up: return "↑"
        case .down: return "↓"
        case .flat: return "→"
        }
    }
}

private func trendDelta(_ points: [TrendPoint], decimals: Int) -> TrendDelta? {
    guard points.count > 1, let latest = points.last?.value else { return nil }
    let prior = points.dropLast().map(\.value)
    let mean = prior.reduce(0, +) / Double(prior.count)
    let diff = latest - mean
    let direction: TrendDelta.Direction = abs(diff) < 0.05 ? .flat : (diff > 0 ? .up : .down)
    return TrendDelta(direction: direction, magnitudeText: String(format: "%.\(decimals)f", abs(diff)))
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
    var caloriesText: String { calories.map { "\(Int($0.rounded())) kcal" } ?? "—" }
    var readinessText: String { readiness.map { String(format: "%.1f", $0) } ?? "—" }
    var hrvTrendPoints: [TrendPoint] { hrvTrend ?? [] }

    var sleepText: String {
        guard let minutes = sleepMin else { return "—" }
        let total = Int(minutes.rounded())
        return "\(total / 60)h \(total % 60)m"
    }

    var sleepDetail: String {
        guard let performance = sleepPerformance else { return "Sleep" }
        return "Sleep · \(Int(performance.rounded()))% of need"
    }

    /// "92% perf · 88% eff", trimmed to whichever of the two is present.
    var sleepSecondaryText: String? {
        var parts: [String] = []
        if let performance = sleepPerformance { parts.append("\(Int(performance.rounded()))% perf") }
        if let efficiency = sleepEfficiency { parts.append("\(Int(efficiency.rounded()))% eff") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
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

    /// Recover / Pace / Ready / Go, short enough for the widget's readiness
    /// badge. Falls back to a neutral word if the band is ever unrecognised,
    /// rather than showing nothing.
    var readinessShortLabel: String {
        switch readinessBand {
        case "recover": return "LOW"
        case "pace": return "PACE"
        case "ready": return "READY"
        case "go": return "GO"
        default: return "READY"
        }
    }

    /// Mirrors the dashboard's readiness band colors: red below "pace",
    /// amber for "pace", green from "ready" up.
    var readinessColor: Color {
        switch readinessBand {
        case "recover": return Color(red: 0.98, green: 0.31, blue: 0.35)
        case "pace": return Color(red: 1.00, green: 0.73, blue: 0.09)
        case "ready", "go": return Color(red: 0.06, green: 0.73, blue: 0.51)
        default: return .secondary
        }
    }

    /// Latest recovery vs. the mean of the rest of `recoveryTrend`.
    var recoveryDelta: TrendDelta? { trendDelta(recoveryTrend, decimals: 0) }

    /// Latest strain vs. the mean of the rest of `strainTrend`.
    var strainDelta: TrendDelta? { trendDelta(strainTrend, decimals: 1) }

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
