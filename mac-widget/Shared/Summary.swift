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
    /// The cycle's average and peak heart rate. Optional in the model as well
    /// as in the data: a widget refreshing before the backend redeploys would
    /// otherwise fail to decode the whole payload over one missing key.
    let avgHr: Double?
    let maxHr: Double?
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
    /// Optional, unlike the other two trends, for the same reason as `avgHr`:
    /// added after the first widget shipped, and a missing key must degrade to
    /// a dash rather than fail the whole decode.
    let hrvTrend: [TrendPoint]?
    let sleepTrend: [TrendPoint]?
    let restingHrTrend: [TrendPoint]?
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

/// `format` is for a metric whose raw unit does not read as a number beside
/// its own value: sleep is held in minutes, so a bare "112" next to "5h 20m"
/// says nothing until it is rendered as a duration too.
private func trendDelta(
    _ points: [TrendPoint],
    decimals: Int,
    format: ((Double) -> String)? = nil
) -> TrendDelta? {
    guard points.count > 1, let latest = points.last?.value else { return nil }
    let prior = points.dropLast().map(\.value)
    let mean = prior.reduce(0, +) / Double(prior.count)
    let diff = latest - mean
    let direction: TrendDelta.Direction = abs(diff) < 0.05 ? .flat : (diff > 0 ? .up : .down)
    let magnitude = format?(abs(diff)) ?? String(format: "%.\(decimals)f", abs(diff))
    return TrendDelta(direction: direction, magnitudeText: magnitude)
}

/// A trend window reduced to what the large layout labels a sparkline with:
/// how many days it covers, the average across them, and the range the line
/// spans. A sparkline on its own shows a shape without a scale; these are the
/// numbers that give it one.
struct TrendStats {
    let count: Int
    let average: Double
    let low: Double
    let high: Double
    let latest: Double

    /// `days` takes the most recent n points rather than the whole window,
    /// since the payload carries thirty days and the large layout quotes a
    /// week. Returns nil for an empty trend, so the caller draws a dash
    /// instead of a zero that looks like a reading.
    init?(_ points: [TrendPoint], days: Int? = nil) {
        let window = days.map { Array(points.suffix($0)) } ?? points
        let values = window.map(\.value)
        guard let latest = values.last,
              let low = values.min(),
              let high = values.max() else { return nil }
        self.count = values.count
        self.average = values.reduce(0, +) / Double(values.count)
        self.low = low
        self.high = high
        self.latest = latest
    }

    func averageText(decimals: Int = 0, unit: String = "") -> String {
        let number = String(format: "%.\(decimals)f", average)
        return unit.isEmpty ? number : "\(number)\(unit)"
    }

    func rangeText(decimals: Int = 0, unit: String = "") -> String {
        let lowText = String(format: "%.\(decimals)f", low)
        let highText = String(format: "%.\(decimals)f", high)
        return unit.isEmpty ? "\(lowText)–\(highText)" : "\(lowText)–\(highText)\(unit)"
    }
}

/// "8h 32m", the one duration format the whole widget uses.
func durationText(_ minutes: Double) -> String {
    let total = Int(minutes.rounded())
    let hours = total / 60
    let rest = total % 60
    return hours > 0 ? "\(hours)h \(rest)m" : "\(rest)m"
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
    var avgHrText: String { avgHr.map { "\(Int($0.rounded())) bpm" } ?? "—" }
    var maxHrText: String { maxHr.map { "\(Int($0.rounded())) bpm" } ?? "—" }
    var hrvTrendPoints: [TrendPoint] { hrvTrend ?? [] }
    var sleepTrendPoints: [TrendPoint] { sleepTrend ?? [] }
    var restingHrTrendPoints: [TrendPoint] { restingHrTrend ?? [] }

    var sleepText: String {
        guard let minutes = sleepMin else { return "—" }
        return durationText(minutes)
    }

    var sleepNeedText: String { sleepNeedMin.map(durationText) ?? "—" }
    var sleepPerformanceText: String { sleepPerformance.map { "\(Int($0.rounded()))%" } ?? "—" }
    var sleepEfficiencyText: String { sleepEfficiency.map { "\(Int($0.rounded()))%" } ?? "—" }

    /// How much of the night's need was actually slept, 0…1, for the large
    /// layout's meter. Capped at 1: sleeping past the need fills the bar
    /// rather than overflowing it.
    var sleepFraction: Double? {
        guard let sleepMin, let need = sleepNeedMin, need > 0 else { return nil }
        return min(max(sleepMin / need, 0), 1)
    }

    /// "1h 05m short" / "32m over", the gap between slept and needed. Whoop
    /// gives a percentage for the same thing; the duration is what tells you
    /// how much earlier to go to bed.
    var sleepBalanceText: String? {
        guard let sleepMin, let need = sleepNeedMin else { return nil }
        let diff = sleepMin - need
        if abs(diff) < 5 { return "on need" }
        return diff < 0 ? "\(durationText(-diff)) short" : "\(durationText(diff)) over"
    }

    /// Whoop's day strain runs 0…21 on a logarithmic scale, so the fraction is
    /// for a progress meter, not a claim that 10.5 is half a hard day.
    var strainFraction: Double? {
        guard let strain else { return nil }
        return min(max(strain / 21, 0), 1)
    }

    /// 0…1 for the readiness meter, from the same 0…10 score as the badge.
    var readinessFraction: Double? {
        guard let readiness else { return nil }
        return min(max(readiness / 10, 0), 1)
    }

    /// "Recover" / "Pace" / "Ready" / "Go" — the badge's word with room to
    /// breathe, for the large layout.
    var readinessLongLabel: String {
        switch readinessBand {
        case "recover": return "Recover"
        case "pace": return "Pace yourself"
        case "ready": return "Ready"
        case "go": return "Go for it"
        default: return "Readiness"
        }
    }

    /// "Updated 08:42", in the viewer's own timezone and clock format. The
    /// widget cannot say it is stale any other way: a cached body and a fresh
    /// one are drawn identically.
    var updatedAtText: String? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var parsed = iso.date(from: updatedAt)
        if parsed == nil {
            iso.formatOptions = [.withInternetDateTime]
            parsed = iso.date(from: updatedAt)
        }
        guard let date = parsed else { return nil }

        let display = DateFormatter()
        display.dateStyle = .none
        display.timeStyle = .short
        return "Updated \(display.string(from: date))"
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

    /// The same comparison for the metrics only the large layout has room to
    /// show a trend for.
    var hrvDelta: TrendDelta? { trendDelta(hrvTrendPoints, decimals: 0) }
    var restingHrDelta: TrendDelta? { trendDelta(restingHrTrendPoints, decimals: 0) }
    var sleepDelta: TrendDelta? { trendDelta(sleepTrendPoints, decimals: 0, format: durationText) }

    /// A week of each metric, for the large layout's labelled trend rows.
    var recoveryWeek: TrendStats? { TrendStats(recoveryTrend, days: 7) }
    var strainWeek: TrendStats? { TrendStats(strainTrend, days: 7) }
    var hrvWeek: TrendStats? { TrendStats(hrvTrendPoints, days: 7) }
    var restingHrWeek: TrendStats? { TrendStats(restingHrTrendPoints, days: 7) }
    var sleepWeek: TrendStats? { TrendStats(sleepTrendPoints, days: 7) }

    /// How many days the payload's window actually has readings for, so the
    /// large layout can say what its averages are averaging.
    var loggedDays: Int {
        Set(recoveryTrend.map(\.day))
            .union(strainTrend.map(\.day))
            .union(sleepTrendPoints.map(\.day))
            .count
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
