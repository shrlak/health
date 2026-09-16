import SwiftUI
import WidgetKit

/// Small pieces the widget and the container app both draw.
///
/// All of the glass — the frosted tiles, the halos, the glows, the gradients —
/// exists only while macOS is drawing the widget in colour, which it does only
/// while the desktop is the front-most thing. Click any window and every
/// desktop widget switches to WidgetKit's `.vibrant` rendering: hue is
/// discarded and what is left is flattened into a wallpaper-tinted material,
/// each pixel's opacity taken from its luminance.
///
/// A `Material` cannot survive that. Vibrant rendering has no way to represent
/// a blur, so `.ultraThinMaterial` collapses into a solid fill at full
/// brightness — which is why the frosted stat tile came back as an opaque slab
/// painted straight over the numbers. Blurs, shadows and glows go the same
/// way, adding haze to the mask instead of depth, and coloured mid-tone text
/// inside all of it flattens to a grey that the slab swallows.
///
/// So every piece below asks which mode it is in, and in the monochrome modes
/// draws flat: no material, no blur, no glow, white ink, hierarchy by opacity.

/// Multiplies the fixed point sizes every view below is written in.
///
/// Those sizes are budgeted for a widget, where a point spent on type is a
/// point taken from the content and the whole thing clips rather than scrolls.
/// The app window has no such ceiling, and at widget sizes its captions read as
/// fine print, so it turns this up rather than each view carrying two sets of
/// numbers.
private struct GlassTextScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1
}

extension EnvironmentValues {
    var glassTextScale: CGFloat {
        get { self[GlassTextScaleKey.self] }
        set { self[GlassTextScaleKey.self] = newValue }
    }
}

extension WidgetRenderingMode {
    /// True wherever hue is discarded and effects are flattened: macOS's
    /// faded desktop widgets (`.vibrant`) and tinted home screens
    /// (`.accented`).
    var isMonochrome: Bool { self != .fullColor }
}

/// The widget's fixed dark-glass identity: a cyan-violet accent used for
/// borders, glow and decoration, kept separate from the recovery ring's
/// red/amber/green bands, which stay a meaningful health signal rather than
/// a decorative color.
enum GlassPalette {
    static let accentStart = Color(red: 0.40, green: 0.80, blue: 1.00)
    static let accentEnd = Color(red: 0.64, green: 0.44, blue: 1.00)
    static let accent = LinearGradient(
        colors: [accentStart, accentEnd],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let backgroundNear = Color(red: 0.08, green: 0.09, blue: 0.15)
    static let backgroundDeep = Color(red: 0.03, green: 0.04, blue: 0.08)
}

/// Per-metric accents, lifted from the dashboard's dark-mode series palette
/// (`src/index.css`) so a stat means the same color here as it does on the
/// Insights tab. The recovery ring keeps its own red/amber/green health bands
/// instead of a slot here, since that color already carries meaning.
enum MetricPalette {
    static let strain = Color(red: 1.00, green: 0.62, blue: 0.18)     // series-3 #ff9d2e
    static let sleep = Color(red: 0.55, green: 0.55, blue: 1.00)      // series-7 #8b8cff
    static let hrv = Color(red: 1.00, green: 0.18, blue: 0.44)        // series-1 #ff2d6f
    static let restingHR = Color(red: 0.13, green: 0.83, blue: 0.77)  // series-4 #22d3c5
}

/// Always-dark backdrop for the widget and the app window. This trades the
/// widget's adaptive system material for a deliberate look, since a
/// washed-out light-mode version of the same glow would not read as
/// intentional.
struct GlassBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [GlassPalette.backgroundNear, GlassPalette.backgroundDeep],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [GlassPalette.accentStart.opacity(0.25), .clear],
                center: .topTrailing,
                startRadius: 6,
                endRadius: 220
            )
        }
    }
}

/// A frosted tile, for giving a group of stats real depth instead of
/// floating flat on the background.
struct GlassCard<Content: View>: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    var cornerRadius: CGFloat = 14
    let content: Content

    init(cornerRadius: CGFloat = 14, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    private var border: AnyShapeStyle {
        renderingMode.isMonochrome
            ? AnyShapeStyle(Color.white.opacity(0.25))
            : AnyShapeStyle(GlassPalette.accent.opacity(0.5))
    }

    var body: some View {
        content
            .background(fill)
            .overlay(shape.strokeBorder(border, lineWidth: 1))
            .overlay(sheen)
    }

    /// The frost is the whole bug. `.ultraThinMaterial` has no vibrant
    /// representation, so it is drawn as a solid at full brightness and covers
    /// everything inside the tile. A flat, barely-there white is the same idea
    /// expressed in something the mode can actually draw: it stays dim in the
    /// mask, so the white numbers on top keep their contrast.
    @ViewBuilder
    private var fill: some View {
        if renderingMode.isMonochrome {
            shape.fill(Color.white.opacity(0.08))
        } else {
            shape.fill(.ultraThinMaterial)
        }
    }

    /// A top-down highlight reads as depth against frost. Against a flattened
    /// mask it is just haze, so it is dropped rather than adapted.
    @ViewBuilder
    private var sheen: some View {
        if !renderingMode.isMonochrome {
            shape
                .fill(LinearGradient(
                    colors: [.white.opacity(0.10), .clear],
                    startPoint: .top,
                    endPoint: .center
                ))
                .allowsHitTesting(false)
        }
    }
}

struct RecoveryRing: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let fraction: Double
    let color: Color
    let label: String
    var lineWidth: CGFloat = 9
    /// The percentage in the middle does not scale with the frame on its own,
    /// so the larger layouts pass a larger size rather than getting a small
    /// number floating in a big ring.
    var labelSize: CGFloat = 20

    private var mono: Bool { renderingMode.isMonochrome }
    /// White is the brightest thing the vibrant mask can be handed, so it is
    /// what comes back most solid. The band colour comes back faint, and the
    /// percentage in the middle says what it said anyway.
    private var arc: Color { mono ? .white : color }

    var body: some View {
        ZStack {
            if !mono {
                // Decorative accent orbit: the fixed identity color, not the signal.
                Circle()
                    .strokeBorder(GlassPalette.accent.opacity(0.35), lineWidth: 1)
                    .padding(-lineWidth * 0.5)

                // Soft halo so the ring reads as glowing rather than flat.
                Circle()
                    .fill(color.opacity(0.30))
                    .blur(radius: lineWidth * 1.2)
                    .padding(lineWidth * 0.8)
            }

            // strokeBorder keeps the whole stroke inside the frame; a plain
            // stroke centres on the path and hangs half its width outside,
            // where the widget's edge shaves it off.
            Circle()
                .strokeBorder(arc.opacity(mono ? 0.28 : 0.18), lineWidth: lineWidth)

            trimmedArc
                .rotationEffect(.degrees(-90))

            Text(label)
                .font(.system(size: labelSize, weight: .semibold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundStyle(.white)
                .padding(.horizontal, lineWidth)
        }
        // The ring is square; without this a caller that frames only one axis
        // gets an oval.
        .aspectRatio(1, contentMode: .fit)
    }

    /// The glow behind the arc is depth in colour and haze in the mask, so it
    /// is only drawn in full colour.
    @ViewBuilder
    private var trimmedArc: some View {
        let stroked = Circle()
            .inset(by: lineWidth / 2)
            .trim(from: 0, to: fraction)
            .stroke(arc, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))

        if mono {
            stroked
        } else {
            stroked.shadow(color: color.opacity(0.75), radius: lineWidth * 0.45)
        }
    }
}

struct Sparkline: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let points: [TrendPoint]
    let color: Color

    private var mono: Bool { renderingMode.isMonochrome }

    var body: some View {
        GeometryReader { geo in
            let values = points.map(\.value)
            // A flat run would divide by zero; a hairline down the middle is
            // the honest picture of it.
            let low = values.min() ?? 0
            let high = values.max() ?? 1
            let span = high - low

            let line = Path { path in
                guard values.count > 1 else { return }
                for (index, value) in values.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(values.count - 1)
                    let normalised = span > 0 ? (value - low) / span : 0.5
                    // The stroke is centred on the path, so the highest and
                    // lowest points need half a line width of room or they
                    // draw flat against the edge.
                    let y = 1.5 + max(geo.size.height - 3, 0) * (1 - CGFloat(normalised))
                    let point = CGPoint(x: x, y: y)
                    if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                }
            }

            let fill = Path { path in
                guard values.count > 1 else { return }
                path.addPath(line)
                path.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height))
                path.addLine(to: CGPoint(x: 0, y: geo.size.height))
                path.closeSubpath()
            }

            ZStack {
                if mono {
                    // The area wash and the blurred underlay are depth in
                    // colour; flattened they are haze that eats the line. A
                    // slightly heavier white stroke survives on its own, a
                    // hairline being the first thing the mask loses.
                    line.stroke(
                        Color.white,
                        style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round)
                    )
                } else {
                    fill.fill(LinearGradient(
                        colors: [color.opacity(0.30), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    ))

                    // A wide, blurred copy of the line behind the crisp one reads
                    // as a glowing stroke rather than a flat one.
                    line.stroke(color.opacity(0.55), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                        .blur(radius: 3)

                    line.stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                }
            }
        }
    }
}

struct Stat: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.glassTextScale) private var textScale
    let label: String
    let value: String
    var color: Color = GlassPalette.accentStart
    var delta: TrendDelta? = nil
    var secondary: String? = nil
    /// Opt in to claiming an equal share of the row. Sized to its own text, a
    /// row of these is only as wide as the longest value in it, so the tile
    /// around them stopped short of its column while the trend lines below —
    /// greedy, being `GeometryReader`-based — ran the full width. The tile
    /// ending early and the lines not is what read as the layout being
    /// skewed to the left.
    var fillsWidth: Bool = false

    private var mono: Bool { renderingMode.isMonochrome }
    /// The metric accents are mid-tone, and a mid-tone is what the mask has
    /// least room for. Once hue is gone the hierarchy has to come from
    /// opacity, so each level of it gets a white at a different weight.
    private func ink(_ opacity: Double) -> Color {
        mono ? Color.white.opacity(opacity) : color.opacity(opacity)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                dot
                Text(label)
                    .font(.system(size: 9 * textScale, weight: mono ? .semibold : .medium))
                    .tracking(1.1)
                    .foregroundStyle(ink(mono ? 0.75 : 0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 14 * textScale, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(.white)
                if let delta, delta.direction != .flat {
                    Text("\(delta.symbol)\(delta.magnitudeText)")
                        .font(.system(size: 8 * textScale, weight: .semibold, design: .rounded))
                        .foregroundStyle(ink(mono ? 0.7 : 0.85))
                }
            }
            if let secondary {
                Text(secondary)
                    .font(.system(size: 7.5 * textScale, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(ink(mono ? 0.6 : 0.7))
            }
        }
        .frame(maxWidth: fillsWidth ? CGFloat.infinity : nil, alignment: .leading)
    }

    @ViewBuilder
    private var dot: some View {
        let circle = Circle()
            .fill(mono ? Color.white.opacity(0.8) : color)
            .frame(width: 5, height: 5)

        if mono {
            circle
        } else {
            circle.shadow(color: color.opacity(0.9), radius: 2.5)
        }
    }
}

/// A small pill for the dashboard's readiness score, sitting under the
/// recovery ring rather than taking a full stat row of its own.
struct ReadinessBadge: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.glassTextScale) private var textScale
    let score: Double
    let shortLabel: String
    let color: Color

    private var mono: Bool { renderingMode.isMonochrome }

    var body: some View {
        HStack(spacing: 3) {
            dot
            Text("\(shortLabel) \(String(format: "%.1f", score))")
                .font(.system(size: 8 * textScale, weight: .semibold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(mono ? Color.white.opacity(0.8) : color.opacity(0.9))
        }
    }

    @ViewBuilder
    private var dot: some View {
        let circle = Circle()
            .fill(mono ? Color.white.opacity(0.8) : color)
            .frame(width: 5, height: 5)

        if mono {
            circle
        } else {
            circle.shadow(color: color.opacity(0.9), radius: 2.5)
        }
    }
}

struct Unavailable: View {
    let message: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 16))
                .foregroundStyle(.white.opacity(0.55))
            Text(message)
                .font(.system(size: 10))
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(6)
        // Centre the message in the widget rather than leaving it wherever
        // the parent's alignment happens to put it.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One labelled row of a trend section: what the metric is, where it stands
/// now, the shape of the last week, and the average and range that shape is
/// drawn against. A sparkline on its own has no scale; this gives it one.
struct TrendRow: View {
    /// A line for a metric that drifts, bars for one that is a separate effort
    /// each day. See `BarChart`.
    enum Style { case line, bars }

    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.glassTextScale) private var textScale
    let label: String
    let value: String
    let points: [TrendPoint]
    let color: Color
    var delta: TrendDelta? = nil
    /// "avg 62% · 41–88%", built by the caller since each metric rounds and
    /// suffixes differently.
    var detail: String? = nil
    var style: Style = .line
    /// Wide enough for a value and its delta side by side. A duration is the
    /// case that sets it: "5h 20m ↓1h 52m" is half as wide again as "92% ↑37",
    /// and the column is shared, so it is sized for the longest row rather
    /// than truncating that one.
    var labelWidth: CGFloat = 76
    var detailWidth: CGFloat = 92
    /// The large layout drops this a couple of points when it has to fit more
    /// rows into the same canvas; see `LargeView`.
    var height: CGFloat = 24

    private var mono: Bool { renderingMode.isMonochrome }

    private func ink(_ opacity: Double) -> Color {
        mono ? Color.white.opacity(opacity) : color.opacity(opacity)
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 8 * textScale, weight: mono ? .semibold : .medium))
                    .tracking(0.9)
                    .foregroundStyle(ink(mono ? 0.75 : 0.9))
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value)
                        .font(.system(size: 11 * textScale, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                    if let delta, delta.direction != .flat {
                        Text("\(delta.symbol)\(delta.magnitudeText)")
                            .font(.system(size: 7.5 * textScale, weight: .semibold, design: .rounded))
                            .foregroundStyle(ink(mono ? 0.7 : 0.85))
                    }
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: labelWidth * textScale, alignment: .leading)

            // A single point has no line to draw, so the row keeps its place
            // in the stack and shows the figures without a shape. Bars survive
            // a lone reading, and draw it.
            if points.count > 1 || (style == .bars && !points.isEmpty) {
                chart.frame(maxWidth: .infinity)
            } else {
                Spacer(minLength: 0)
            }

            if let detail {
                Text(detail)
                    .font(.system(size: 7.5 * textScale, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(Color.white.opacity(mono ? 0.6 : 0.5))
                    .frame(width: detailWidth * textScale, alignment: .trailing)
            }
        }
        // The columns and the row grow with the type, or larger text in the
        // same box is just text with less room to be in.
        .frame(height: height * textScale)
    }

    @ViewBuilder
    private var chart: some View {
        switch style {
        case .line: Sparkline(points: points, color: color)
        case .bars: BarChart(points: points, color: color)
        }
    }
}

/// A small caps heading with a hairline running out to the edge, for dividing
/// the large layout into sections that a glance can skip between.
struct SectionHeader: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.glassTextScale) private var textScale
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 8 * textScale, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Color.white.opacity(renderingMode.isMonochrome ? 0.7 : 0.55))
            Rectangle()
                .fill(Color.white.opacity(renderingMode.isMonochrome ? 0.2 : 0.12))
                .frame(height: 1)
        }
    }
}

/// A ring for any figure with a ceiling, captioned with what it is and what
/// the ceiling was. `RecoveryRing` stays its own view: it is the headline, so
/// it is drawn larger and keeps the health-band glow, where these are a set
/// meant to be read together at a glance.
struct RingGauge: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.glassTextScale) private var textScale
    let title: String
    let value: String
    var caption: String? = nil
    /// 0…1, or nil when the figure has not been scored — an empty ring rather
    /// than a full one at zero.
    let fraction: Double?
    let color: Color
    var diameter: CGFloat = 54
    var lineWidth: CGFloat = 6
    var valueSize: CGFloat = 13

    private var mono: Bool { renderingMode.isMonochrome }
    private var arc: Color { mono ? .white : color }

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                Circle()
                    .strokeBorder(arc.opacity(mono ? 0.28 : 0.16), lineWidth: lineWidth)

                if let fraction {
                    trimmed(fraction)
                        .rotationEffect(.degrees(-90))
                }

                Text(value)
                    .font(.system(size: valueSize, weight: .semibold, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .foregroundStyle(.white)
                    .padding(.horizontal, lineWidth)
            }
            .frame(width: diameter, height: diameter)

            Text(title)
                .font(.system(size: 8 * textScale, weight: mono ? .semibold : .medium))
                .tracking(0.9)
                .foregroundStyle(mono ? Color.white.opacity(0.75) : color.opacity(0.9))

            if let caption {
                Text(caption)
                    .font(.system(size: 7.5 * textScale, weight: .medium))
                    .foregroundStyle(.white.opacity(mono ? 0.6 : 0.5))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }

    @ViewBuilder
    private func trimmed(_ fraction: Double) -> some View {
        let stroked = Circle()
            .inset(by: lineWidth / 2)
            .trim(from: 0, to: max(min(fraction, 1), 0))
            .stroke(arc, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))

        if mono {
            stroked
        } else {
            stroked.shadow(color: color.opacity(0.7), radius: lineWidth * 0.4)
        }
    }
}

/// The day's heart rate as a range rather than three separate numbers: a track
/// running from the resting rate to the peak, with the average marked where it
/// actually fell between them. Three figures in a column say what they were;
/// this says how hard the day was.
struct HeartRateRange: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.glassTextScale) private var textScale
    let resting: Double?
    let average: Double?
    let peak: Double?
    var trackHeight: CGFloat = 7

    private var mono: Bool { renderingMode.isMonochrome }

    /// Where the average sits between resting and peak, 0…1. Nil whenever the
    /// three do not make a range to place it in — a missing figure, or a peak
    /// that is not above the resting rate.
    private var position: Double? {
        guard let resting, let peak, let average, peak > resting else { return nil }
        return min(max((average - resting) / (peak - resting), 0), 1)
    }

    /// Resting through to peak, so the track itself says which end is which:
    /// the resting accent on the left, strain's orange through the middle, and
    /// HRV's red at the top of the range.
    private var gradient: LinearGradient {
        LinearGradient(
            colors: mono
                ? [.white.opacity(0.3), .white.opacity(0.7)]
                : [MetricPalette.restingHR.opacity(0.75),
                   MetricPalette.strain.opacity(0.75),
                   MetricPalette.hrv.opacity(0.75)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text("HEART RATE")
                    .font(.system(size: 8.5 * textScale, weight: mono ? .semibold : .medium))
                    .tracking(1.0)
                    .foregroundStyle(mono ? Color.white.opacity(0.75)
                                          : MetricPalette.restingHR.opacity(0.9))
                Spacer(minLength: 4)
                Text(label)
                    .font(.system(size: 8 * textScale, weight: .medium))
                    .foregroundStyle(.white.opacity(mono ? 0.7 : 0.55))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(gradient)

                    if let position {
                        // The marker is inset by its own width at both ends so
                        // an average sitting on the resting rate or the peak
                        // stays inside the track instead of half outside it.
                        let span = max(geo.size.width - trackHeight * 2, 0)
                        Circle()
                            .fill(Color.white)
                            .frame(width: trackHeight * 1.6, height: trackHeight * 1.6)
                            .overlay(Circle().strokeBorder(Color.black.opacity(0.35), lineWidth: 1))
                            .offset(x: trackHeight * 0.2 + span * CGFloat(position))
                    }
                }
            }
            .frame(height: trackHeight)
        }
    }

    /// "42 rest · 65 avg · 122 peak", trimmed to whichever exist.
    private var label: String {
        var parts: [String] = []
        if let resting { parts.append("\(Int(resting.rounded())) rest") }
        if let average { parts.append("\(Int(average.rounded())) avg") }
        if let peak { parts.append("\(Int(peak.rounded())) peak") }
        return parts.joined(separator: " · ")
    }
}

/// A trend as columns rather than a line. A line reads as one continuous thing
/// and suits a metric that drifts; a day's strain is a separate effort each
/// time, and bars say that where a line implies a slope between them.
struct BarChart: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let points: [TrendPoint]
    let color: Color

    private var mono: Bool { renderingMode.isMonochrome }

    var body: some View {
        GeometryReader { geo in
            let values = points.map(\.value)
            let high = values.max() ?? 1
            // Against its own minimum a flat run would draw every bar at zero,
            // so the floor is zero and the bars keep their proportions.
            let span = high > 0 ? high : 1
            let gap: CGFloat = 2
            let width = values.isEmpty ? 0
                : max((geo.size.width - gap * CGFloat(values.count - 1)) / CGFloat(values.count), 1)

            HStack(alignment: .bottom, spacing: gap) {
                ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                    let height = max(geo.size.height * CGFloat(value / span), 2)
                    // The newest column is the one the numbers above describe,
                    // so it is drawn solid and the rest step back.
                    let newest = index == values.count - 1
                    RoundedRectangle(cornerRadius: min(width / 2, 2), style: .continuous)
                        .fill(mono
                              ? Color.white.opacity(newest ? 0.9 : 0.45)
                              : color.opacity(newest ? 1 : 0.5))
                        .frame(width: width, height: height)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottomLeading)
        }
    }
}
