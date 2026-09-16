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
        VStack(spacing: 6) {
            RecoveryRing(
                fraction: summary.recoveryFraction,
                color: summary.recoveryColor,
                label: summary.recoveryText
            )
            .frame(width: 62, height: 62)

            Spacer(minLength: 2)

            // Side by side rather than stacked: the small size runs out of
            // height long before it runs out of width, and stacked rows put
            // the second one past the bottom edge, where it was clipped away
            // rather than shrunk.
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "STRAIN", value: summary.strainText,
                     color: MetricPalette.strain, fillsWidth: true)
                Stat(label: "SLEEP", value: summary.sleepText,
                     color: MetricPalette.sleep, fillsWidth: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct MediumView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let summary: Summary

    private var mono: Bool { renderingMode.isMonochrome }

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
                        .font(.system(size: 9, weight: mono ? .semibold : .medium))
                        .tracking(1.1)
                        .foregroundStyle(mono ? Color.white.opacity(0.75)
                                              : summary.recoveryColor.opacity(0.9))
                    if let delta = summary.recoveryDelta, delta.direction != .flat {
                        Text("\(delta.symbol)\(delta.magnitudeText)")
                            .font(.system(size: 8, weight: .semibold, design: .rounded))
                            .foregroundStyle(mono ? Color.white.opacity(0.7)
                                                  : summary.recoveryColor.opacity(0.85))
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

            VStack(alignment: .leading, spacing: 5) {
                Text(summary.dayText)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(mono ? 0.8 : 0.7))
                    .lineLimit(1)

                GlassCard(cornerRadius: 10) {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 12) {
                            Stat(
                                label: "STRAIN", value: summary.strainText,
                                color: MetricPalette.strain, delta: summary.strainDelta,
                                secondary: summary.calories != nil ? summary.caloriesText : nil,
                                fillsWidth: true
                            )
                            Stat(
                                label: "SLEEP", value: summary.sleepText,
                                color: MetricPalette.sleep, secondary: summary.sleepSecondaryText,
                                fillsWidth: true
                            )
                        }
                        HStack(spacing: 12) {
                            Stat(label: "HRV", value: summary.hrvText,
                                 color: MetricPalette.hrv, fillsWidth: true)
                            Stat(label: "RESTING HR", value: summary.restingHrText,
                                 color: MetricPalette.restingHR, fillsWidth: true)
                        }
                    }
                    .padding(6)
                    // The tile spans its column, so its right edge lines up
                    // with the trend lines underneath instead of stopping
                    // wherever the longest value happened to end.
                    .frame(maxWidth: .infinity, alignment: .leading)
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
                    .frame(height: 16)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One row of the large layout's trend section, built once and then handed to
/// whichever density ends up fitting.
private struct TrendSpec: Identifiable {
    let id: String
    let label: String
    let value: String
    let points: [TrendPoint]
    let color: Color
    let delta: TrendDelta?
    let detail: String
    let style: TrendRow.Style
}

/// The large size, which is the one with room to show the day rather than
/// list it: three rings for the figures that have a ceiling, the day's heart
/// rate as a range, strain as columns and the rest as trend lines.
///
/// A widget cannot scroll and clips whatever does not fit, and macOS gives the
/// large family a fixed canvas that is not the same on every display scale. So
/// rather than one layout tuned to a guessed height, the same sections are
/// offered at a few densities and `ViewThatFits` takes the richest one that
/// actually fits: the rings and the day's numbers are in every variant, and
/// the trend rows and the heart-rate diagram are what give way on a tight one.
struct LargeView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let summary: Summary

    private var mono: Bool { renderingMode.isMonochrome }

    var body: some View {
        ViewThatFits(in: .vertical) {
            stacked(trendRows: 5, ring: 78, spacing: 10, showHeartRate: true)
            stacked(trendRows: 4, ring: 74, spacing: 9, showHeartRate: true)
            stacked(trendRows: 3, ring: 70, spacing: 8, showHeartRate: true)
            stacked(trendRows: 2, ring: 66, spacing: 8, showHeartRate: true)
            stacked(trendRows: 1, ring: 62, spacing: 7, showHeartRate: true)
            stacked(trendRows: 1, ring: 60, spacing: 6, showHeartRate: false)
            stacked(trendRows: 0, ring: 56, spacing: 5, showHeartRate: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: Arrangements

    /// Each variant is the same sections in the same order; only the rings,
    /// the gaps and how much of the trend section survives change.
    private func stacked(trendRows: Int, ring: CGFloat, spacing: CGFloat, showHeartRate: Bool) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            header
            ringRow(diameter: ring)
            if showHeartRate { heartRate }
            statTile
            if trendRows > 0 {
                trendsSection(limit: trendRows, rowHeight: trendRows >= 4 ? 22 : 24)
            }
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Sections

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("WHOOP")
                .font(.system(size: 9, weight: .bold))
                .tracking(2.0)
                .foregroundStyle(mono ? Color.white.opacity(0.75) : GlassPalette.accentStart)
            Spacer(minLength: 6)
            Text(summary.dayText)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(mono ? 0.8 : 0.7))
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }

    /// The three figures that only mean something against a ceiling, drawn as
    /// the same shape so they can be compared at a glance: recovery out of a
    /// hundred, the night against the need Whoop set for it, the day's strain
    /// against a maxed-out one.
    ///
    /// Each caption carries the figure that belongs with it — the readiness
    /// score under recovery, the need under sleep, the calories under strain —
    /// which is what lets the tile below stay to two stats.
    private func ringRow(diameter: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 10) {
            RingGauge(
                title: "RECOVERY",
                value: summary.recoveryText,
                caption: summary.readiness != nil
                    ? "\(summary.readinessShortLabel) \(summary.readinessText)" : nil,
                fraction: summary.recoveryRingFraction,
                color: summary.recoveryColor,
                diameter: diameter,
                lineWidth: diameter * 0.12,
                valueSize: diameter * 0.26
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "SLEEP",
                value: summary.sleepPercentText,
                caption: summary.sleepMin != nil ? summary.sleepText : nil,
                fraction: summary.sleepPercentFraction,
                color: MetricPalette.sleep,
                diameter: diameter,
                lineWidth: diameter * 0.12,
                valueSize: diameter * 0.26
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "STRAIN",
                value: summary.strainText,
                caption: summary.calories != nil ? summary.caloriesText : "of 21",
                fraction: summary.strainFraction,
                color: MetricPalette.strain,
                diameter: diameter,
                lineWidth: diameter * 0.12,
                valueSize: diameter * 0.26
            )
            .frame(maxWidth: .infinity)
        }
    }

    private var heartRate: some View {
        HeartRateRange(
            resting: summary.restingHr,
            average: summary.avgHr,
            peak: summary.maxHr
        )
    }

    /// What is left once the rings and the heart-rate track have taken their
    /// share: the two metrics with no ceiling to draw them against, each shown
    /// against its own week instead.
    private var statTile: some View {
        GlassCard(cornerRadius: 12) {
            HStack(spacing: 10) {
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
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// A week of each metric, every line labelled with where it stands now and
    /// the average and range the shape is drawn against.
    private func trendsSection(limit: Int, rowHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SectionHeader(title: "LAST 7 DAYS")
            ForEach(trendSpecs.prefix(limit)) { spec in
                TrendRow(
                    label: spec.label, value: spec.value, points: spec.points,
                    color: spec.color, delta: spec.delta, detail: spec.detail,
                    style: spec.style, height: rowHeight
                )
            }
        }
    }

    /// Built in the order they are worth losing from the bottom: recovery
    /// leads, strain follows as the one drawn with bars, and the three the
    /// rings and the tile already carry as numbers go last.
    private var trendSpecs: [TrendSpec] {
        var specs: [TrendSpec] = []

        if let week = summary.recoveryWeek {
            specs.append(TrendSpec(
                id: "recovery", label: "RECOVERY", value: summary.recoveryText,
                points: Array(summary.recoveryTrend.suffix(7)),
                color: summary.recoveryColor, delta: summary.recoveryDelta,
                detail: "avg \(week.averageText(unit: "%")) · \(week.rangeText(unit: "%"))",
                style: .line
            ))
        }
        if let week = summary.strainWeek {
            specs.append(TrendSpec(
                id: "strain", label: "STRAIN", value: summary.strainText,
                points: Array(summary.strainTrend.suffix(7)),
                color: MetricPalette.strain, delta: summary.strainDelta,
                detail: "avg \(week.averageText(decimals: 1)) · \(week.rangeText(decimals: 1))",
                // A day's strain is a separate effort, not a level that drifts
                // between readings, so it is the one drawn as columns.
                style: .bars
            ))
        }
        if let week = summary.hrvWeek {
            specs.append(TrendSpec(
                id: "hrv", label: "HRV", value: summary.hrvText,
                points: Array(summary.hrvTrendPoints.suffix(7)),
                color: MetricPalette.hrv, delta: summary.hrvDelta,
                detail: "avg \(week.averageText(unit: " ms")) · \(week.rangeText())",
                style: .line
            ))
        }
        if let week = summary.restingHrWeek {
            specs.append(TrendSpec(
                id: "restingHr", label: "RESTING HR", value: summary.restingHrText,
                points: Array(summary.restingHrTrendPoints.suffix(7)),
                color: MetricPalette.restingHR, delta: summary.restingHrDelta,
                detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())",
                style: .line
            ))
        }
        if let week = summary.sleepWeek {
            specs.append(TrendSpec(
                id: "sleep", label: "SLEEP", value: summary.sleepText,
                points: Array(summary.sleepTrendPoints.suffix(7)),
                color: MetricPalette.sleep, delta: summary.sleepDelta,
                detail: "avg \(durationText(week.average)) · \(durationText(week.low))–\(durationText(week.high))",
                style: .line
            ))
        }

        return specs
    }

    /// When the numbers were fetched, and how much history they were judged
    /// against — a widget has no other way to say how much it knows.
    private var footer: some View {
        Text(footerText)
            .font(.system(size: 8, weight: .medium))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(.white.opacity(mono ? 0.6 : 0.45))
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Joined rather than stacked in an `HStack`, so a missing piece takes its
    /// separator with it instead of leaving the line starting with a dot.
    private var footerText: String {
        var parts: [String] = []
        if let updated = summary.updatedAtText { parts.append(updated) }
        if summary.loggedDays > 0 { parts.append("\(summary.loggedDays) days logged") }
        return parts.joined(separator: " · ")
    }
}

struct WhoopWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WhoopEntry

    var body: some View {
        content
            // Own the inset rather than taking the system's. macOS reserves
            // 16pt per edge, sized for a phone's home screen, which left the
            // medium column a dozen points short of fitting — and a widget
            // clips what does not fit instead of shrinking it.
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(for: .widget) { GlassBackground() }
    }

    @ViewBuilder
    private var content: some View {
        if let summary = entry.summary {
            if summary.day == nil {
                Unavailable(message: "Nothing synced yet")
            } else {
                switch family {
                case .systemSmall: SmallView(summary: summary)
                case .systemMedium: MediumView(summary: summary)
                default: LargeView(summary: summary)
                }
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
        .description("Recovery, strain and sleep from your Whoop. "
                     + "The large size adds heart rate, sleep against need, and a week of every trend.")
        // The three sizes macOS offers, so the size is a choice made when the
        // widget is dragged out rather than one baked in here. There is no
        // fourth: `systemExtraLarge` is an iPad family, unavailable to a macOS
        // target, and naming it here does not compile.
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
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
