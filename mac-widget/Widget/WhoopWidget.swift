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
}

/// The large size, which is the one with room to answer "why" as well as
/// "what": every figure the endpoint returns, each against its own baseline,
/// rather than the four headline numbers the smaller sizes fit.
///
/// A widget cannot scroll and clips whatever does not fit, and macOS gives the
/// large family a fixed canvas that is not the same on every display scale. So
/// rather than one layout tuned to a guessed height, the same sections are
/// offered at a few densities and `ViewThatFits` takes the richest one that
/// actually fits: everything at full size on a roomy canvas, fewer trend rows
/// and a smaller ring on a tight one, with the day's own numbers — the part
/// that is not a nice-to-have — kept in every variant.
struct LargeView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let summary: Summary
    /// Extra-large gets the same sections in two columns rather than a taller
    /// stack, which would leave half of it empty.
    var wide: Bool = false

    private var mono: Bool { renderingMode.isMonochrome }

    @ViewBuilder
    var body: some View {
        if wide {
            wideLayout
        } else {
            ViewThatFits(in: .vertical) {
                stacked(trendRows: 5, ring: 84, spacing: 10, showMeters: true)
                stacked(trendRows: 4, ring: 78, spacing: 9, showMeters: true)
                stacked(trendRows: 3, ring: 72, spacing: 8, showMeters: true)
                stacked(trendRows: 2, ring: 66, spacing: 7, showMeters: true)
                stacked(trendRows: 2, ring: 62, spacing: 6, showMeters: false)
                stacked(trendRows: 0, ring: 58, spacing: 5, showMeters: false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    // MARK: Arrangements

    /// Each variant is the same sections in the same order; only the ring, the
    /// gaps and how much of the trend section survives change.
    private func stacked(trendRows: Int, ring: CGFloat, spacing: CGFloat, showMeters: Bool) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            header
            hero(ringSize: ring)
            // Two columns while there is height for three rows; three narrower
            // columns once there is not, so all six figures survive in two
            // rows rather than two of them being dropped.
            statTile(columns: trendRows >= 4 ? 2 : 3)
            if showMeters { metersSection }
            if trendRows > 0 {
                trendsSection(limit: trendRows, rowHeight: trendRows >= 4 ? 23 : 21)
            }
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var wideLayout: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    hero(ringSize: 96)
                    statTile(columns: 2)
                    metersSection
                    Spacer(minLength: 0)
                }
                VStack(alignment: .leading, spacing: 12) {
                    trendsSection(limit: 5, rowHeight: 28)
                    Spacer(minLength: 0)
                }
            }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

    /// The ring, and beside it what the readiness score is made of: the band
    /// in words, the score out of ten as a meter, and how today's recovery
    /// sits against the days around it.
    private func hero(ringSize: CGFloat) -> some View {
        HStack(alignment: .center, spacing: 14) {
            RecoveryRing(
                fraction: summary.recoveryFraction,
                color: summary.recoveryColor,
                label: summary.recoveryText,
                lineWidth: ringSize * 0.12,
                labelSize: ringSize * 0.28
            )
            .frame(width: ringSize, height: ringSize)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Text("RECOVERY")
                        .font(.system(size: 9, weight: mono ? .semibold : .medium))
                        .tracking(1.1)
                        .foregroundStyle(mono ? Color.white.opacity(0.75)
                                              : summary.recoveryColor.opacity(0.9))
                    if let delta = summary.recoveryDelta, delta.direction != .flat {
                        Text("\(delta.symbol)\(delta.magnitudeText) vs recent")
                            .font(.system(size: 8, weight: .semibold, design: .rounded))
                            .foregroundStyle(mono ? Color.white.opacity(0.7)
                                                  : summary.recoveryColor.opacity(0.85))
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)

                Text(summary.readinessLongLabel)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                MeterBar(
                    label: "READINESS",
                    value: "\(summary.readinessText)/10",
                    fraction: summary.readinessFraction,
                    color: summary.readinessColor
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Everything the day itself was: the four headline metrics, plus the
    /// three the smaller sizes have no room for — calories, and the average
    /// and peak heart rate behind the strain score.
    private func statTile(columns: Int) -> some View {
        GlassCard(cornerRadius: 12) {
            VStack(alignment: .leading, spacing: columns == 2 ? 7 : 8) {
                if columns == 2 {
                    HStack(spacing: 10) {
                        strainStat
                        sleepStat
                    }
                    HStack(spacing: 10) {
                        hrvStat
                        restingHrStat
                    }
                    HStack(spacing: 10) {
                        avgHrStat
                        peakHrStat
                    }
                } else {
                    HStack(spacing: 10) {
                        strainStat
                        sleepStat
                        hrvStat
                    }
                    HStack(spacing: 10) {
                        restingHrStat
                        avgHrStat
                        peakHrStat
                    }
                }
            }
            .padding(columns == 2 ? 8 : 7)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var strainStat: Stat {
        Stat(
            label: "STRAIN", value: summary.strainText,
            color: MetricPalette.strain, delta: summary.strainDelta,
            secondary: summary.calories != nil ? summary.caloriesText : nil,
            fillsWidth: true
        )
    }

    private var sleepStat: Stat {
        Stat(
            label: "SLEEP", value: summary.sleepText,
            color: MetricPalette.sleep, delta: summary.sleepDelta,
            secondary: summary.sleepSecondaryText,
            fillsWidth: true
        )
    }

    private var hrvStat: Stat {
        Stat(
            label: "HRV", value: summary.hrvText,
            color: MetricPalette.hrv, delta: summary.hrvDelta,
            secondary: summary.hrvWeek.map { "7d \($0.averageText()) ms" },
            fillsWidth: true
        )
    }

    private var restingHrStat: Stat {
        Stat(
            label: "RESTING HR", value: summary.restingHrText,
            color: MetricPalette.restingHR, delta: summary.restingHrDelta,
            secondary: summary.restingHrWeek.map { "7d \($0.averageText()) bpm" },
            fillsWidth: true
        )
    }

    private var avgHrStat: Stat {
        Stat(label: "AVG HR", value: summary.avgHrText,
             color: GlassPalette.accentStart, fillsWidth: true)
    }

    private var peakHrStat: Stat {
        Stat(label: "PEAK HR", value: summary.maxHrText,
             color: GlassPalette.accentEnd, fillsWidth: true)
    }

    /// The two figures that only mean something against a ceiling: the night
    /// against the need Whoop calculated for it, and the day's strain against
    /// a maxed-out one.
    private var metersSection: some View {
        VStack(alignment: .leading, spacing: 7) {
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
                color: MetricPalette.strain,
                caption: summary.strainWeek.map { "7d avg \($0.averageText(decimals: 1))" }
            )
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
                    height: rowHeight
                )
            }
        }
    }

    /// Built in the order they are worth losing from the bottom: recovery and
    /// strain are the two the dashboard leads with, sleep next, and the two
    /// that also appear as numbers in the tile above go last.
    private var trendSpecs: [TrendSpec] {
        var specs: [TrendSpec] = []

        if let week = summary.recoveryWeek {
            specs.append(TrendSpec(
                id: "recovery", label: "RECOVERY", value: summary.recoveryText,
                points: Array(summary.recoveryTrend.suffix(7)),
                color: summary.recoveryColor, delta: summary.recoveryDelta,
                detail: "avg \(week.averageText(unit: "%")) · \(week.rangeText(unit: "%"))"
            ))
        }
        if let week = summary.strainWeek {
            specs.append(TrendSpec(
                id: "strain", label: "STRAIN", value: summary.strainText,
                points: Array(summary.strainTrend.suffix(7)),
                color: MetricPalette.strain, delta: summary.strainDelta,
                detail: "avg \(week.averageText(decimals: 1)) · \(week.rangeText(decimals: 1))"
            ))
        }
        if let week = summary.sleepWeek {
            specs.append(TrendSpec(
                id: "sleep", label: "SLEEP", value: summary.sleepText,
                points: Array(summary.sleepTrendPoints.suffix(7)),
                color: MetricPalette.sleep, delta: nil,
                detail: "avg \(durationText(week.average)) · \(durationText(week.low))–\(durationText(week.high))"
            ))
        }
        if let week = summary.hrvWeek {
            specs.append(TrendSpec(
                id: "hrv", label: "HRV", value: summary.hrvText,
                points: Array(summary.hrvTrendPoints.suffix(7)),
                color: MetricPalette.hrv, delta: summary.hrvDelta,
                detail: "avg \(week.averageText(unit: " ms")) · \(week.rangeText())"
            ))
        }
        if let week = summary.restingHrWeek {
            specs.append(TrendSpec(
                id: "restingHr", label: "RESTING HR", value: summary.restingHrText,
                points: Array(summary.restingHrTrendPoints.suffix(7)),
                color: MetricPalette.restingHR, delta: summary.restingHrDelta,
                detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())"
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
                case .systemExtraLarge: LargeView(summary: summary, wide: true)
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
                     + "The larger sizes add heart rate, sleep against need, and a week of every trend.")
        // Every size macOS offers, so the size is a choice made when the
        // widget is dragged out rather than one baked in here. A family the
        // running system does not offer simply never appears in the gallery.
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
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
