import SwiftUI
import WidgetKit

/// The widget itself.
///
/// WidgetKit decides when this runs and gives it no chance to report a
/// problem anywhere else, so a failed fetch is drawn in the widget rather than
/// logged and swallowed: a blank panel and a stale one look identical.

struct WhoopEntry: TimelineEntry {
    let date: Date
    let summary: Summary?
    let failure: String?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> WhoopEntry {
        WhoopEntry(date: Date(), summary: nil, failure: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (WhoopEntry) -> Void) {
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WhoopEntry>) -> Void) {
        Task {
            let entry = await load()
            // The backend re-pulls from Whoop every fifteen minutes, so
            // matching that is as often as this can usefully change.
            // WidgetKit treats it as a request, not a promise.
            let next = Date().addingTimeInterval(15 * 60)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func load() async -> WhoopEntry {
        do {
            return WhoopEntry(date: Date(), summary: try await fetchSummary(), failure: nil)
        } catch {
            return WhoopEntry(date: Date(), summary: nil, failure: error.localizedDescription)
        }
    }
}

// MARK: - Layouts

struct SmallView: View {
    let summary: Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                RecoveryRing(
                    fraction: summary.recoveryFraction,
                    color: summary.recoveryColor,
                    label: summary.recoveryText
                )
                .frame(width: 62, height: 62)
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 3) {
                Stat(label: "STRAIN", value: summary.strainText, color: MetricPalette.strain)
                Stat(label: "SLEEP", value: summary.sleepText, color: MetricPalette.sleep)
            }
            Spacer(minLength: 0)
        }
    }
}

struct MediumView: View {
    let summary: Summary

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 5) {
                RecoveryRing(
                    fraction: summary.recoveryFraction,
                    color: summary.recoveryColor,
                    label: summary.recoveryText
                )
                .frame(width: 74, height: 74)
                HStack(spacing: 3) {
                    Text("RECOVERY")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1.1)
                        .foregroundStyle(summary.recoveryColor.opacity(0.9))
                    if let delta = summary.recoveryDelta, delta.direction != .flat {
                        Text("\(delta.symbol)\(delta.magnitudeText)")
                            .font(.system(size: 8, weight: .semibold, design: .rounded))
                            .foregroundStyle(summary.recoveryColor.opacity(0.85))
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                if let readiness = summary.readiness {
                    ReadinessBadge(
                        score: readiness,
                        shortLabel: summary.readinessShortLabel,
                        color: summary.readinessColor
                    )
                }
            }
            .frame(width: 84)

            VStack(alignment: .leading, spacing: 7) {
                Text(summary.dayText)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))

                GlassCard(cornerRadius: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 16) {
                            Stat(
                                label: "STRAIN", value: summary.strainText,
                                color: MetricPalette.strain, delta: summary.strainDelta,
                                secondary: summary.calories != nil ? summary.caloriesText : nil
                            )
                            Stat(
                                label: "SLEEP", value: summary.sleepText,
                                color: MetricPalette.sleep, secondary: summary.sleepSecondaryText
                            )
                        }
                        HStack(spacing: 16) {
                            Stat(label: "HRV", value: summary.hrvText, color: MetricPalette.hrv)
                            Stat(label: "RESTING HR", value: summary.restingHrText, color: MetricPalette.restingHR)
                        }
                    }
                    .padding(8)
                }

                // Recovery, strain and HRV each get their own trend line:
                // recovery keeps its health-band color, the other two their
                // metric accents.
                if summary.recoveryTrend.count > 1 || summary.strainTrend.count > 1 || summary.hrvTrendPoints.count > 1 {
                    HStack(spacing: 6) {
                        if summary.recoveryTrend.count > 1 {
                            Sparkline(points: summary.recoveryTrend, color: summary.recoveryColor)
                        }
                        if summary.strainTrend.count > 1 {
                            Sparkline(points: summary.strainTrend, color: MetricPalette.strain)
                        }
                        if summary.hrvTrendPoints.count > 1 {
                            Sparkline(points: summary.hrvTrendPoints, color: MetricPalette.hrv)
                        }
                    }
                    .frame(height: 18)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct WhoopWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WhoopEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { GlassBackground() }
    }

    @ViewBuilder
    private var content: some View {
        if let summary = entry.summary {
            if summary.day == nil {
                Unavailable(message: "Nothing synced yet")
            } else if family == .systemSmall {
                SmallView(summary: summary)
            } else {
                MediumView(summary: summary)
            }
        } else {
            Unavailable(message: entry.failure ?? "Loading…")
        }
    }
}

// MARK: - Entry point

struct WhoopWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhoopWidget", provider: Provider()) { entry in
            WhoopWidgetView(entry: entry)
        }
        .configurationDisplayName("Whoop")
        .description("Recovery, strain and sleep from your Whoop.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct WhoopWidgetBundle: WidgetBundle {
    var body: some Widget {
        WhoopWidget()
    }
}
