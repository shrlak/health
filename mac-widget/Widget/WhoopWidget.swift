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
//
// A widget gets a fixed box and clips anything that does not fit rather than
// shrinking it, and macOS spends 16pt of every edge on its own margins. That
// left 126pt of height for content that wanted 131, so the lower stats were
// drawn outside the box and simply never appeared. These layouts set their own
// margins (see `contentMarginsDisabled` below), fit inside them with room to
// spare, and claim the whole box so the content sits centred instead of
// packing against the leading edge with all the slack thrown to the right.

struct SmallView: View {
    let summary: Summary

    var body: some View {
        VStack(spacing: 5) {
            RecoveryRing(
                fraction: summary.recoveryFraction,
                color: summary.recoveryColor,
                label: summary.recoveryText
            )
            .frame(width: 62, height: 62)
            Caption(text: "RECOVERY")

            Spacer(minLength: 4)

            HStack(alignment: .top, spacing: 8) {
                Stat(label: "STRAIN", value: summary.strainText)
                Stat(label: "SLEEP", value: summary.sleepText)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct MediumView: View {
    let summary: Summary

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(spacing: 5) {
                RecoveryRing(
                    fraction: summary.recoveryFraction,
                    color: summary.recoveryColor,
                    label: summary.recoveryText
                )
                .frame(width: 72, height: 72)
                Caption(text: "RECOVERY")
            }
            // A fixed width makes the right-hand column's share of the widget
            // the same whatever the number in the ring is.
            .frame(width: 84)

            VStack(alignment: .leading, spacing: 6) {
                Text(summary.dayText)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                // A grid keeps HRV under STRAIN and RESTING HR under SLEEP;
                // as two independent HStacks the columns did not line up.
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
                    GridRow {
                        Stat(label: "STRAIN", value: summary.strainText)
                        Stat(label: "SLEEP", value: summary.sleepText)
                    }
                    GridRow {
                        Stat(label: "HRV", value: summary.hrvText)
                        Stat(label: "RESTING HR", value: summary.restingHrText)
                    }
                }

                if summary.recoveryTrend.count > 1 {
                    Sparkline(points: summary.recoveryTrend, color: summary.recoveryColor)
                        .frame(height: 16)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct WhoopWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WhoopEntry

    var body: some View {
        content
            // Own the inset rather than taking the system's. macOS reserves
            // 16pt per edge, which is sized for a phone's home screen and cost
            // more height than these layouts had to give.
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        // The layouts pad themselves; see WhoopWidgetView.
        .contentMarginsDisabled()
    }
}

@main
struct WhoopWidgetBundle: WidgetBundle {
    var body: some Widget {
        WhoopWidget()
    }
}
