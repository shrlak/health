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
            // Whoop finalises a night when you wake and the backend re-pulls
            // every six hours, so a quarter of an hour is as often as this can
            // usefully change. WidgetKit treats it as a request, not a promise.
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
                Stat(label: "STRAIN", value: summary.strainText)
                Stat(label: "SLEEP", value: summary.sleepText)
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
                Text("RECOVERY")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text(summary.dayText)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)

                HStack(spacing: 16) {
                    Stat(label: "STRAIN", value: summary.strainText)
                    Stat(label: "SLEEP", value: summary.sleepText)
                }
                HStack(spacing: 16) {
                    Stat(label: "HRV", value: summary.hrvText)
                    Stat(label: "RESTING HR", value: summary.restingHrText)
                }

                if summary.recoveryTrend.count > 1 {
                    Sparkline(points: summary.recoveryTrend, color: summary.recoveryColor)
                        .frame(height: 20)
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
            .containerBackground(.fill.tertiary, for: .widget)
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
