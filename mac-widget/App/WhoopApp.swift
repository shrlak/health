import SwiftUI
import WidgetKit

/// The container app.
///
/// macOS only offers widgets that ship inside an installed application, so
/// this exists mainly to carry the extension. It shows the same figures, which
/// makes it the place to find out why the widget is blank: if this window says
/// the token was rejected, so would the widget, silently.
@main
struct WhoopApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .defaultSize(width: 780, height: 880)
    }
}

struct ContentView: View {
    @State private var summary: Summary?
    @State private var failure: String?
    @State private var loading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Whoop")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(GlassPalette.accent)

            if loading {
                ProgressView().frame(maxWidth: .infinity)
            } else if let summary, summary.day != nil {
                // Scrolled rather than stacked: the window now carries every
                // figure the large widget does, and a shrunken window should
                // scroll it rather than clip it the way a widget would.
                ScrollView {
                    loaded(summary).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Label(failure ?? "Nothing synced yet", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.white.opacity(0.7))
            }

            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 6) {
                Text("Adding the widget")
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.85))
                Text("Right-click the desktop, choose Edit Widgets, search for Whoop, "
                     + "and drag the size you want into place. Small shows recovery, "
                     + "strain and sleep; medium adds HRV, resting heart rate and trend "
                     + "lines; large adds heart rate, sleep against need and a labelled "
                     + "week of every metric. Drop a second copy to keep two sizes at once.")
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.55))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            Button("Refresh") {
                WidgetCenter.shared.reloadAllTimelines()
                Task { await load() }
            }
        }
        .padding(20)
        // Those views are written in sizes budgeted for a widget, where the
        // captions are fine print on a desktop. Nothing here is fighting for
        // room, so the whole scale goes up together.
        .environment(\.glassTextScale, 1.45)
        // A readable column rather than the whole window. Stretched across a
        // wide window the trend rows pulled their captions hundreds of points
        // away from the line they describe, which is its own kind of skew.
        .frame(maxWidth: 780, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(GlassBackground())
        .task { await load() }
    }

    /// The same figures the large widget draws, since this window is where you
    /// come to find out why the widget looks wrong — a value missing here is a
    /// value the endpoint did not return, not a layout that dropped it.
    ///
    /// Everything inside the card shares one left edge and one width, and
    /// every figure with a ceiling is a ring, so the top of the window can be
    /// read without being parsed.
    @ViewBuilder
    private func loaded(_ summary: Summary) -> some View {
        GlassCard(cornerRadius: 16) {
            VStack(alignment: .leading, spacing: 18) {
                header(summary)
                rings(summary)
                dayTrends(summary)
                heart(summary)
                footer(summary)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func header(_ summary: Summary) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(summary.dayText)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white.opacity(0.9))
            Spacer(minLength: 8)
            Text(summary.readinessLongLabel)
                .font(.headline)
                .foregroundStyle(summary.readinessColor)
        }
        .lineLimit(1)
    }

    /// Everything with a ceiling, drawn as the same shape so the row can be
    /// compared across rather than read down: recovery out of a hundred,
    /// readiness out of ten, the night against the need Whoop set for it,
    /// strain against a maxed-out day, and the calories against the hardest
    /// day in the window — the only one of the five whose ceiling is not a
    /// fixed number, since a day's burn has none of its own.
    private func rings(_ summary: Summary) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RingGauge(
                title: "RECOVERY",
                value: summary.recoveryText,
                caption: summary.recoveryDelta.map { "\($0.symbol)\($0.magnitudeText) vs recent" },
                fraction: summary.recoveryRingFraction,
                color: summary.recoveryColor,
                diameter: 92, lineWidth: 11, valueSize: 24
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "READINESS",
                value: summary.readinessText,
                caption: "of 10",
                fraction: summary.readinessFraction,
                color: summary.readinessColor,
                diameter: 76, lineWidth: 9, valueSize: 20
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "SLEEP",
                value: summary.sleepText,
                caption: summary.sleepNeedMin != nil ? "of \(summary.sleepNeedText)" : nil,
                fraction: summary.sleepFraction,
                color: MetricPalette.sleep,
                diameter: 76, lineWidth: 9, valueSize: 16
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "STRAIN",
                value: summary.strainText,
                caption: "of 21",
                fraction: summary.strainFraction,
                color: MetricPalette.strain,
                diameter: 76, lineWidth: 9, valueSize: 20
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "CALORIES",
                value: summary.calories.map { "\(Int($0.rounded()))" } ?? "—",
                caption: summary.caloriesCeilingText ?? "kcal",
                fraction: summary.caloriesFraction,
                color: GlassPalette.accentStart,
                diameter: 76, lineWidth: 9, valueSize: 17
            )
            .frame(maxWidth: .infinity)
        }
    }

    /// Recovery, strain and sleep over the week. The three heart metrics get
    /// their own section below rather than sharing this one, since they are
    /// read together and against each other.
    @ViewBuilder
    private func dayTrends(_ summary: Summary) -> some View {
        if summary.recoveryWeek != nil || summary.strainWeek != nil || summary.sleepWeek != nil {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "LAST 7 DAYS")
                if let week = summary.recoveryWeek {
                    TrendRow(
                        label: "RECOVERY", value: summary.recoveryText,
                        points: Array(summary.recoveryTrend.suffix(7)),
                        color: summary.recoveryColor, delta: summary.recoveryDelta,
                        detail: "avg \(week.averageText(unit: "%")) · \(week.rangeText(unit: "%"))"
                    )
                }
                if let week = summary.strainWeek {
                    TrendRow(
                        label: "STRAIN", value: summary.strainText,
                        points: Array(summary.strainTrend.suffix(7)),
                        color: MetricPalette.strain, delta: summary.strainDelta,
                        detail: "avg \(week.averageText(decimals: 1)) · \(week.rangeText(decimals: 1))",
                        style: .bars
                    )
                }
                if let week = summary.sleepWeek {
                    TrendRow(
                        label: "SLEEP", value: summary.sleepText,
                        points: Array(summary.sleepTrendPoints.suffix(7)),
                        color: MetricPalette.sleep, delta: summary.sleepDelta,
                        detail: "avg \(durationText(week.average)) · \(durationText(week.low))–\(durationText(week.high))"
                    )
                }
            }
        }
    }

    /// The four heart metrics, each with its number, how it moved, and a week
    /// of it. None has a ceiling to be drawn against, so each is shown against
    /// its own recent range instead.
    @ViewBuilder
    private func heart(_ summary: Summary) -> some View {
        if summary.hrvWeek != nil || summary.restingHrWeek != nil
            || summary.avgHrWeek != nil || summary.maxHrWeek != nil {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "HEART")

                HeartRateRange(
                    resting: summary.restingHr,
                    average: summary.avgHr,
                    peak: summary.maxHr,
                    trackHeight: 9
                )

                if let week = summary.hrvWeek {
                    TrendRow(
                        label: "HRV", value: summary.hrvText,
                        points: Array(summary.hrvTrendPoints.suffix(7)),
                        color: MetricPalette.hrv, delta: summary.hrvDelta,
                        detail: "avg \(week.averageText(unit: " ms")) · \(week.rangeText())"
                    )
                }
                if let week = summary.restingHrWeek {
                    TrendRow(
                        label: "RESTING HR", value: summary.restingHrText,
                        points: Array(summary.restingHrTrendPoints.suffix(7)),
                        color: MetricPalette.restingHR, delta: summary.restingHrDelta,
                        detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())"
                    )
                }
                if let week = summary.avgHrWeek {
                    TrendRow(
                        label: "AVG HR", value: summary.avgHrText,
                        points: Array(summary.avgHrTrendPoints.suffix(7)),
                        color: GlassPalette.accentStart, delta: summary.avgHrDelta,
                        detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())"
                    )
                }
                if let week = summary.maxHrWeek {
                    TrendRow(
                        label: "PEAK HR", value: summary.maxHrText,
                        points: Array(summary.maxHrTrendPoints.suffix(7)),
                        color: GlassPalette.accentEnd, delta: summary.maxHrDelta,
                        detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func footer(_ summary: Summary) -> some View {
        if let updated = summary.updatedAtText {
            Text("\(updated) · \(summary.loggedDays) days logged")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.5))
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            summary = try await fetchSummary()
            failure = nil
        } catch {
            summary = nil
            failure = error.localizedDescription
        }
    }
}
