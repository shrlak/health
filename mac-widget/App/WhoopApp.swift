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
        .defaultSize(width: 420, height: 640)
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(GlassBackground())
        .task { await load() }
    }

    /// The same figures the large widget draws, since this window is where you
    /// come to find out why the widget looks wrong — a value missing here is a
    /// value the endpoint did not return, not a layout that dropped it.
    @ViewBuilder
    private func loaded(_ summary: Summary) -> some View {
        GlassCard(cornerRadius: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 18) {
                    VStack(spacing: 6) {
                        RecoveryRing(
                            fraction: summary.recoveryFraction,
                            color: summary.recoveryColor,
                            label: summary.recoveryText,
                            lineWidth: 11,
                            labelSize: 22
                        )
                        .frame(width: 92, height: 92)
                        if let readiness = summary.readiness {
                            ReadinessBadge(
                                score: readiness,
                                shortLabel: summary.readinessShortLabel,
                                color: summary.readinessColor
                            )
                        }
                    }

                    VStack(alignment: .leading, spacing: 9) {
                        Text(summary.dayText).font(.subheadline).foregroundStyle(.white.opacity(0.7))
                        Stat(
                            label: "STRAIN", value: summary.strainText,
                            color: MetricPalette.strain, delta: summary.strainDelta,
                            secondary: summary.calories != nil ? summary.caloriesText : nil
                        )
                        Stat(
                            label: "SLEEP", value: summary.sleepText,
                            color: MetricPalette.sleep, delta: summary.sleepDelta,
                            secondary: summary.sleepSecondaryText
                        )
                        Stat(label: "HRV", value: summary.hrvText,
                             color: MetricPalette.hrv, delta: summary.hrvDelta)
                        Stat(label: "RESTING HR", value: summary.restingHrText,
                             color: MetricPalette.restingHR, delta: summary.restingHrDelta)
                        HStack(spacing: 16) {
                            Stat(label: "AVG HR", value: summary.avgHrText,
                                 color: GlassPalette.accentStart, fillsWidth: true)
                            Stat(label: "PEAK HR", value: summary.maxHrText,
                                 color: GlassPalette.accentEnd, fillsWidth: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                MeterBar(
                    label: "SLEEP VS NEED",
                    value: "\(summary.sleepText) of \(summary.sleepNeedText)",
                    fraction: summary.sleepFraction,
                    color: MetricPalette.sleep,
                    caption: summary.sleepBalanceText
                )
                MeterBar(
                    label: "DAY STRAIN",
                    value: "\(summary.strainText) of 21",
                    fraction: summary.strainFraction,
                    color: MetricPalette.strain
                )

                if summary.recoveryWeek != nil || summary.strainWeek != nil {
                    SectionHeader(title: "LAST 7 DAYS")
                    if let week = summary.recoveryWeek {
                        TrendRow(
                            label: "RECOVERY", value: summary.recoveryText,
                            points: Array(summary.recoveryTrend.suffix(7)),
                            color: summary.recoveryColor, delta: summary.recoveryDelta,
                            detail: "avg \(week.averageText(unit: "%"))"
                        )
                    }
                    if let week = summary.strainWeek {
                        TrendRow(
                            label: "STRAIN", value: summary.strainText,
                            points: Array(summary.strainTrend.suffix(7)),
                            color: MetricPalette.strain, delta: summary.strainDelta,
                            detail: "avg \(week.averageText(decimals: 1))"
                        )
                    }
                    if let week = summary.sleepWeek {
                        TrendRow(
                            label: "SLEEP", value: summary.sleepText,
                            points: Array(summary.sleepTrendPoints.suffix(7)),
                            color: MetricPalette.sleep,
                            detail: "avg \(durationText(week.average))"
                        )
                    }
                }

                if let updated = summary.updatedAtText {
                    Text("\(updated) · \(summary.loggedDays) days logged")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.45))
                }
            }
            .padding(14)
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
