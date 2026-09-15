import SwiftUI

/// Small pieces the widget and the container app both draw.

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
    var cornerRadius: CGFloat = 14
    let content: Content

    init(cornerRadius: CGFloat = 14, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    var body: some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(GlassPalette.accent.opacity(0.5), lineWidth: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(LinearGradient(
                        colors: [.white.opacity(0.10), .clear],
                        startPoint: .top,
                        endPoint: .center
                    ))
                    .allowsHitTesting(false)
            )
    }
}

struct RecoveryRing: View {
    let fraction: Double
    let color: Color
    let label: String
    var lineWidth: CGFloat = 9

    var body: some View {
        ZStack {
            // Decorative accent orbit: the fixed identity color, not the signal.
            Circle()
                .strokeBorder(GlassPalette.accent.opacity(0.35), lineWidth: 1)
                .padding(-lineWidth * 0.5)

            // Soft halo so the ring reads as glowing rather than flat.
            Circle()
                .fill(color.opacity(0.30))
                .blur(radius: lineWidth * 1.2)
                .padding(lineWidth * 0.8)

            Circle()
                .stroke(color.opacity(0.18), lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: fraction)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: color.opacity(0.75), radius: lineWidth * 0.45)

            Text(label)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.55), radius: 2)
        }
    }
}

struct Sparkline: View {
    let points: [TrendPoint]
    let color: Color

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
                    let y = geo.size.height * (1 - CGFloat(normalised))
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

struct Stat: View {
    let label: String
    let value: String
    var color: Color = GlassPalette.accentStart
    var delta: TrendDelta? = nil
    var secondary: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Circle()
                    .fill(color)
                    .frame(width: 5, height: 5)
                    .shadow(color: color.opacity(0.9), radius: 2.5)
                Text(label)
                    .font(.system(size: 9, weight: .medium))
                    .tracking(1.1)
                    .foregroundStyle(color.opacity(0.9))
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(.white)
                if let delta, delta.direction != .flat {
                    Text("\(delta.symbol)\(delta.magnitudeText)")
                        .font(.system(size: 8, weight: .semibold, design: .rounded))
                        .foregroundStyle(color.opacity(0.85))
                }
            }
            if let secondary {
                Text(secondary)
                    .font(.system(size: 7.5, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(color.opacity(0.7))
            }
        }
    }
}

/// A small pill for the dashboard's readiness score, sitting under the
/// recovery ring rather than taking a full stat row of its own.
struct ReadinessBadge: View {
    let score: Double
    let shortLabel: String
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)
                .shadow(color: color.opacity(0.9), radius: 2.5)
            Text("\(shortLabel) \(String(format: "%.1f", score))")
                .font(.system(size: 8, weight: .semibold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(color.opacity(0.9))
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
    }
}
