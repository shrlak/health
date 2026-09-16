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
        .defaultSize(width: 620, height: 720)
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
        // A readable column rather than the whole window. Stretched across a
        // wide window the trend rows pulled their captions hundreds of points
        // away from the line they describe, which is its own kind of skew.
        .frame(maxWidth: 620, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(GlassBackground())
        .task { await load() }
    }

    /// The same figures the large widget draws, since this window is where you
    /// come to find out why the widget looks wrong — a value missing here is a
    /// value the endpoint did not return, not a layout that dropped it.
    ///
    /// Everything inside the card shares one left edge and one width. An
    /// earlier version had two: the stats were indented into a column beside
    /// the ring while the meters and trends spanned the card, and within the
    /// stats four cells were sized to their own text while two spanned the
    /// row. Three competing widths in one card is what read as skew.
    @ViewBuilder
    private func loaded(_ summary: Summary) -> some View {
        GlassCard(cornerRadius: 16) {
            VStack(alignment: .leading, spacing: 16) {
                header(summary)
                hero(summary)
                statGrid(summary)
                trends(summary)
                footer(summary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func header(_ summary: Summary) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(summary.dayText)
                .font(.headline)
                .foregroundStyle(.white.opacity(0.85))
            Spacer(minLength: 8)
            Text(summary.readinessLongLabel)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(summary.readinessColor)
        }
        .lineLimit(1)
    }

    /// The ring gets a column exactly its own width, and the meters sit beside
    /// it. Left alone in a full-height column the ring floated in its own dead
    /// space, centred against a stack twice its height.
    private func hero(_ summary: Summary) -> some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(spacing: 8) {
                RecoveryRing(
                    fraction: summary.recoveryFraction,
                    color: summary.recoveryColor,
                    label: summary.recoveryText,
                    lineWidth: 11,
                    labelSize: 24
                )
                .frame(width: 104, height: 104)

                Text("RECOVERY")
                    .font(.system(size: 9, weight: .medium))
                    .tracking(1.1)
                    .foregroundStyle(summary.recoveryColor.opacity(0.9))
            }
            .frame(width: 104)

            VStack(alignment: .leading, spacing: 12) {
                if let readiness = summary.readiness {
                    MeterBar(
                        label: "READINESS",
                        value: "\(summary.readinessText)/10",
                        fraction: summary.readinessFraction,
                        color: summary.readinessColor,
                        height: 6
                    )
                    .accessibilityLabel("Readiness \(String(format: "%.1f", readiness)) out of ten")
                }
                MeterBar(
                    label: "SLEEP VS NEED",
                    value: "\(summary.sleepText) of \(summary.sleepNeedText)",
                    fraction: summary.sleepFraction,
                    color: MetricPalette.sleep,
                    caption: summary.sleepBalanceText,
                    height: 6
                )
                MeterBar(
                    label: "DAY STRAIN",
                    value: "\(summary.strainText) of 21",
                    fraction: summary.strainFraction,
                    color: MetricPalette.strain,
                    caption: summary.strainWeek.map { "7d avg \($0.averageText(decimals: 1))" },
                    height: 6
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Two equal columns, every cell claiming its share. Sized to their own
    /// text the rows each ended wherever their value stopped, so the block had
    /// a ragged right edge and no column to read down.
    private func statGrid(_ summary: Summary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 16) {
                Stat(
                    label: "STRAIN", value: summary.strainText,
                    color: MetricPalette.strain, delta: summary.strainDelta,
                    secondary: summary.calories != nil ? summary.caloriesText : nil,
                    fillsWidth: true
                )
                Stat(
                    label: "SLEEP", value: summary.sleepText,
                    color: MetricPalette.sleep, delta: summary.sleepDelta,
                    secondary: summary.sleepSecondaryText,
                    fillsWidth: true
                )
            }
            HStack(alignment: .top, spacing: 16) {
                Stat(
                    label: "HRV", value: summary.hrvText,
                    color: MetricPalette.hrv, delta: summary.hrvDelta,
                    secondary: summary.hrvWeek.map { "7d avg \($0.averageText()) ms" },
                    fillsWidth: true
                )
                Stat(
                    label: "RESTING HR", value: summary.restingHrText,
                    color: MetricPalette.restingHR, delta: summary.restingHrDelta,
                    secondary: summary.restingHrWeek.map { "7d avg \($0.averageText()) bpm" },
                    fillsWidth: true
                )
            }
            HStack(alignment: .top, spacing: 16) {
                Stat(label: "AVG HR", value: summary.avgHrText,
                     color: GlassPalette.accentStart, fillsWidth: true)
                Stat(label: "PEAK HR", value: summary.maxHrText,
                     color: GlassPalette.accentEnd, fillsWidth: true)
            }
        }
    }

    @ViewBuilder
    private func trends(_ summary: Summary) -> some View {
        if summary.recoveryWeek != nil || summary.strainWeek != nil || summary.sleepWeek != nil {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "LAST 7 DAYS")
                if let week = summary.recoveryWeek {
                    TrendRow(
                        label: "RECOVERY", value: summary.recoveryText,
                        points: Array(summary.recoveryTrend.suffix(7)),
                        color: summary.recoveryColor, delta: summary.recoveryDelta,
                        detail: "avg \(week.averageText(unit: "%")) · \(week.rangeText(unit: "%"))",
                        height: 28
                    )
                }
                if let week = summary.strainWeek {
                    TrendRow(
                        label: "STRAIN", value: summary.strainText,
                        points: Array(summary.strainTrend.suffix(7)),
                        color: MetricPalette.strain, delta: summary.strainDelta,
                        detail: "avg \(week.averageText(decimals: 1)) · \(week.rangeText(decimals: 1))",
                        height: 28
                    )
                }
                if let week = summary.sleepWeek {
                    TrendRow(
                        label: "SLEEP", value: summary.sleepText,
                        points: Array(summary.sleepTrendPoints.suffix(7)),
                        color: MetricPalette.sleep, delta: summary.sleepDelta,
                        detail: "avg \(durationText(week.average)) · \(durationText(week.low))–\(durationText(week.high))",
                        height: 28
                    )
                }
                if let week = summary.hrvWeek {
                    TrendRow(
                        label: "HRV", value: summary.hrvText,
                        points: Array(summary.hrvTrendPoints.suffix(7)),
                        color: MetricPalette.hrv, delta: summary.hrvDelta,
                        detail: "avg \(week.averageText(unit: " ms")) · \(week.rangeText())",
                        height: 28
                    )
                }
                if let week = summary.restingHrWeek {
                    TrendRow(
                        label: "RESTING HR", value: summary.restingHrText,
                        points: Array(summary.restingHrTrendPoints.suffix(7)),
                        color: MetricPalette.restingHR, delta: summary.restingHrDelta,
                        detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())",
                        height: 28
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func footer(_ summary: Summary) -> some View {
        if let updated = summary.updatedAtText {
            Text("\(updated) · \(summary.loggedDays) days logged")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.45))
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
