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

/// One row of a trend section, built once and then handed to whichever density
/// ends up fitting.
private struct TrendSpec: Identifiable {
    let id: String
    let label: String
    let value: String
    let color: Color
    let delta: TrendDelta?
    let detail: String
}

/// The widget, drawn as the app window draws it: the same sections in the same
/// order, so the thing on the desktop and the thing you open are one design.
///
/// What differs is the room. The window is 780pt wide with its type scaled up
/// and a scroll view under it; this is roughly 329x345 and clips whatever does
/// not fit. So the sections are the same and the budget is not: the whole
/// thing is offered at a ladder of densities that `ViewThatFits` picks
/// from — the rings in every one, the heart rows first to go.
struct LargeView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let summary: Summary

    private var mono: Bool { renderingMode.isMonochrome }

    var body: some View {
        ViewThatFits(in: .vertical) {
            stacked(ring: 50, dayRows: 3, heartRows: 4, spacing: 8)
            stacked(ring: 48, dayRows: 3, heartRows: 3, spacing: 7)
            stacked(ring: 46, dayRows: 3, heartRows: 2, spacing: 7)
            stacked(ring: 44, dayRows: 2, heartRows: 2, spacing: 6)
            stacked(ring: 42, dayRows: 2, heartRows: 1, spacing: 6)
            stacked(ring: 40, dayRows: 2, heartRows: 0, spacing: 5)
            stacked(ring: 38, dayRows: 1, heartRows: 0, spacing: 5)
            stacked(ring: 36, dayRows: 0, heartRows: 0, spacing: 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: Arrangements

    private func stacked(ring: CGFloat, dayRows: Int, heartRows: Int, spacing: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            header
            rings(diameter: ring)
            if dayRows > 0 {
                section(title: "LAST 7 DAYS", specs: daySpecs, limit: dayRows, rowHeight: 20)
            }
            if heartRows > 0 {
                VStack(alignment: .leading, spacing: 3) {
                    SectionHeader(title: "HEART")
                    HeartRateRange(
                        resting: summary.restingHr,
                        average: summary.avgHr,
                        peak: summary.maxHr
                    )
                    ForEach(heartSpecs.prefix(heartRows)) { spec in
                        row(spec, height: 20)
                    }
                }
            }
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Sections

    /// The day on the left and the readiness band on the right, as the window
    /// has it. The app's own name is not worth a line here: the widget is
    /// identified by being the one with the rings on it.
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(summary.dayText)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(mono ? 0.85 : 0.9))
            Spacer(minLength: 6)
            Text(summary.readinessLongLabel)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(mono ? Color.white.opacity(0.75) : summary.readinessColor)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }

    /// Everything with a ceiling, as the same shape: recovery out of a
    /// hundred, readiness out of ten, the night as a percentage of its need,
    /// strain against a maxed-out day, and the burn against the day before.
    private func rings(diameter: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 5) {
            RingGauge(
                title: "RECOVERY", value: summary.recoveryText,
                caption: summary.recoveryDelta.map { "\($0.symbol)\($0.magnitudeText)" },
                fraction: summary.recoveryRingFraction, color: summary.recoveryColor,
                diameter: diameter, lineWidth: diameter * 0.13, valueSize: diameter * 0.30
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "READINESS", value: summary.readinessText, caption: "of 10",
                fraction: summary.readinessFraction, color: summary.readinessColor,
                diameter: diameter, lineWidth: diameter * 0.13, valueSize: diameter * 0.30
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "SLEEP", value: summary.sleepPercentText,
                caption: summary.sleepMin != nil ? summary.sleepText : nil,
                fraction: summary.sleepPercentFraction, color: MetricPalette.sleep,
                diameter: diameter, lineWidth: diameter * 0.13, valueSize: diameter * 0.30
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "STRAIN", value: summary.strainText, caption: "of 21",
                fraction: summary.strainFraction, color: MetricPalette.strain,
                diameter: diameter, lineWidth: diameter * 0.13, valueSize: diameter * 0.30
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "CALORIES", value: summary.caloriesValueText,
                // The same comparison the window makes, without the words:
                // "vs yesterday" does not fit a fifth of this width.
                caption: summary.caloriesVsYesterdayShortText ?? "kcal",
                fraction: summary.caloriesFraction, color: GlassPalette.accentStart,
                diameter: diameter, lineWidth: diameter * 0.13, valueSize: diameter * 0.26
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func section(title: String, specs: [TrendSpec], limit: Int, rowHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SectionHeader(title: title)
            ForEach(specs.prefix(limit)) { spec in
                row(spec, height: rowHeight)
            }
        }
    }

    private func row(_ spec: TrendSpec, height: CGFloat) -> some View {
        TrendRow(
            label: spec.label, value: spec.value, color: spec.color,
            delta: spec.delta, detail: spec.detail, height: height
        )
    }

    // MARK: The rows themselves

    /// Recovery, strain and sleep, in the order they are worth losing from the
    /// bottom.
    private var daySpecs: [TrendSpec] {
        var specs: [TrendSpec] = []
        if let week = summary.recoveryWeek {
            specs.append(TrendSpec(
                id: "recovery", label: "RECOVERY", value: summary.recoveryText,
                color: summary.recoveryColor, delta: summary.recoveryDelta,
                detail: "avg \(week.averageText(unit: "%")) · \(week.rangeText(unit: "%"))"
            ))
        }
        if let week = summary.strainWeek {
            specs.append(TrendSpec(
                id: "strain", label: "STRAIN", value: summary.strainText,
                color: MetricPalette.strain, delta: summary.strainDelta,
                detail: "avg \(week.averageText(decimals: 1)) · \(week.rangeText(decimals: 1))"
            ))
        }
        if let week = summary.sleepWeek {
            specs.append(TrendSpec(
                id: "sleep", label: "SLEEP", value: summary.sleepText,
                color: MetricPalette.sleep, delta: summary.sleepDelta,
                detail: "avg \(durationText(week.average)) · \(durationText(week.low))–\(durationText(week.high))"
            ))
        }
        return specs
    }

    /// The four with no ceiling to draw them against, each shown against its
    /// own week instead.
    private var heartSpecs: [TrendSpec] {
        var specs: [TrendSpec] = []
        if let week = summary.hrvWeek {
            specs.append(TrendSpec(
                id: "hrv", label: "HRV", value: summary.hrvText,
                color: MetricPalette.hrv, delta: summary.hrvDelta,
                detail: "avg \(week.averageText(unit: " ms")) · \(week.rangeText())"
            ))
        }
        if let week = summary.restingHrWeek {
            specs.append(TrendSpec(
                id: "restingHr", label: "RESTING HR", value: summary.restingHrText,
                color: MetricPalette.restingHR, delta: summary.restingHrDelta,
                detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())"
            ))
        }
        if let week = summary.avgHrWeek {
            specs.append(TrendSpec(
                id: "avgHr", label: "AVG HR", value: summary.avgHrText,
                color: GlassPalette.accentStart, delta: summary.avgHrDelta,
                detail: "avg \(week.averageText(unit: " bpm")) · \(week.rangeText())"
            ))
        }
        if let week = summary.maxHrWeek {
            specs.append(TrendSpec(
                id: "maxHr", label: "PEAK HR", value: summary.maxHrText,
                color: GlassPalette.accentEnd, delta: summary.maxHrDelta,
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
        .description("Recovery, sleep and strain as rings, the day's heart rate "
                     + "from resting to peak, and a week of every trend.")
        // Large only.
        //
        // A widget's size is picked in the gallery when it is dragged out, and
        // the default is the smallest offered — so registering three families
        // means the easiest thing to do is come away with the small one. This
        // is written to be the large one, and offering only that is the sole
        // way a widget can say so: there is no API for a preferred size.
        //
        // `SmallView` and `MediumView` are kept rather than deleted. They are
        // complete layouts, tuned against a canvas that clips rather than
        // shrinks, and re-offering either is adding its family back to this
        // line — which is a cheaper thing to keep working than to rebuild.
        .supportedFamilies([.systemLarge])
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
