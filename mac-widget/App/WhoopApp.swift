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
        VStack(alignment: .leading, spacing: 20) {
            Text("Whoop")
                .font(.system(size: 26, weight: .bold, design: .rounded))
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
                     + "and drag it into place. Only the large size is offered: "
                     + "recovery, readiness, sleep and strain as rings, the day's heart "
                     + "rate, and a labelled week of every metric.")
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
        .padding(24)
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
            VStack(alignment: .leading, spacing: 24) {
                header(summary)
                rings(summary)
                dayTrends(summary)
                heart(summary)
                footer(summary)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func header(_ summary: Summary) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(summary.dayText)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.9))
            Spacer(minLength: 8)
            Text(summary.readinessLongLabel)
                .font(.title3.weight(.semibold))
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
        HStack(alignment: .top, spacing: 16) {
            RingGauge(
                title: "RECOVERY",
                value: summary.recoveryText,
                caption: summary.recoveryDelta.map { "\($0.symbol)\($0.magnitudeText) vs recent" },
                fraction: summary.recoveryRingFraction,
                color: summary.recoveryColor,
                diameter: 106, lineWidth: 13, valueSize: 28
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "READINESS",
                value: summary.readinessText,
                caption: "of 10",
                fraction: summary.readinessFraction,
                color: summary.readinessColor,
                diameter: 88, lineWidth: 10, valueSize: 23
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "SLEEP",
                value: summary.sleepPercentText,
                caption: summary.sleepMin != nil ? summary.sleepText : nil,
                fraction: summary.sleepPercentFraction,
                color: MetricPalette.sleep,
                diameter: 88, lineWidth: 10, valueSize: 23
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "STRAIN",
                value: summary.strainText,
                caption: "of 21",
                fraction: summary.strainFraction,
                color: MetricPalette.strain,
                diameter: 88, lineWidth: 10, valueSize: 23
            )
            .frame(maxWidth: .infinity)

            RingGauge(
                title: "CALORIES",
                value: summary.caloriesValueText,
                caption: summary.caloriesVsYesterdayText ?? "kcal",
                fraction: summary.caloriesFraction,
                color: GlassPalette.accentStart,
                diameter: 88, lineWidth: 10, valueSize: 20
            )
            .frame(maxWidth: .infinity)
        }
    }

    /// Recovery, strain and sleep over the week. The four heart metrics get
    /// their own section below rather than sharing this one, since they are
    /// read together and against each other.
    @ViewBuilder
    private func dayTrends(_ summary: Summary) -> some View {
        let specs = daySpecs(summary)
        if !specs.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                SectionHeader(title: "LAST 7 DAYS")
                columns(specs)
            }
        }
    }

    /// The four heart metrics, each with its number, how it moved, and a week
    /// of it. None has a ceiling to be drawn against, so each is shown against
    /// its own recent range instead.
    @ViewBuilder
    private func heart(_ summary: Summary) -> some View {
        let specs = heartSpecs(summary)
        if !specs.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                SectionHeader(title: "HEART")
                columns(specs)
            }
        }
    }

    // MARK: Trend rows

    /// One row's worth of a trend section, built once and then handed to
    /// `columns` rather than laid out inline, so recovery/strain/sleep and the
    /// four heart metrics can share one two-column arrangement.
    private struct TrendSpec: Identifiable {
        let id: String
        let label: String
        let value: String
        let color: Color
        let delta: TrendDelta?
        let detail: String
    }

    private func daySpecs(_ summary: Summary) -> [TrendSpec] {
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

    private func heartSpecs(_ summary: Summary) -> [TrendSpec] {
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

    private func row(_ spec: TrendSpec) -> some View {
        TrendRow(label: spec.label, value: spec.value, color: spec.color,
                 delta: spec.delta, detail: spec.detail)
    }

    /// Two to a line rather than one long column, since a figure and its week
    /// take far less width than they do height. An odd one out gets the line
    /// to itself rather than stretching to fill its partner's half.
    private func columns(_ specs: [TrendSpec]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(stride(from: 0, to: specs.count, by: 2)), id: \.self) { index in
                HStack(alignment: .top, spacing: 32) {
                    row(specs[index]).frame(maxWidth: .infinity, alignment: .leading)
                    if index + 1 < specs.count {
                        row(specs[index + 1]).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Spacer(minLength: 0).frame(maxWidth: .infinity)
                    }
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
