import SwiftUI
import WidgetKit

/// Small pieces the widget and the container app both draw.
///
/// Two constraints shape all of them.
///
/// A widget is given a fixed box and clips whatever does not fit rather than
/// shrinking it, so each of these reports an honest size and keeps its ink
/// inside its own frame.
///
/// And macOS only draws a desktop widget in colour while the desktop is the
/// front-most thing. Click any window and it switches to `.vibrant`: the hue
/// is discarded and what is left becomes a wallpaper-tinted material, with
/// each pixel's opacity taken from its luminance. Light on light is the one
/// thing that cannot survive that — background and text map to the same
/// brightness and the numbers dissolve into a grey slab — so in that mode
/// everything here draws white and the widget's background goes dark.

extension WidgetRenderingMode {
    /// True wherever hue is discarded: macOS's faded desktop widgets
    /// (`.vibrant`) and tinted home screens (`.accented`).
    var isMonochrome: Bool { self != .fullColor }
}

struct RecoveryRing: View {
    @Environment(\.widgetRenderingMode) private var mode
    let fraction: Double
    let color: Color
    let label: String
    var lineWidth: CGFloat = 9

    /// White is the brightest thing vibrant rendering can be handed, so it is
    /// what comes back most solid. A tinted stroke comes back faint.
    private var arc: Color { mode.isMonochrome ? .white : color }
    private var track: Color {
        mode.isMonochrome ? Color.white.opacity(0.3) : color.opacity(0.18)
    }

    var body: some View {
        ZStack {
            // strokeBorder insets the path by half the line width so the whole
            // stroke lands inside the frame. A plain stroke centres itself on
            // the path and hangs half its width outside, which the widget's
            // own edge then shaves off.
            Circle()
                .strokeBorder(track, lineWidth: lineWidth)
            Circle()
                .inset(by: lineWidth / 2)
                .trim(from: 0, to: fraction)
                .stroke(arc, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            // The percentage says what the band colour says, which is why
            // losing the hue loses no information.
            Text(label)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .foregroundStyle(mode.isMonochrome ? Color.white : Color.primary)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                // Keep the number inside the ring rather than over it.
                .padding(.horizontal, lineWidth)
        }
        // The ring is square; without this a caller that frames only one axis
        // gets an oval.
        .aspectRatio(1, contentMode: .fit)
    }
}

struct Sparkline: View {
    @Environment(\.widgetRenderingMode) private var mode
    let points: [TrendPoint]
    let color: Color
    var lineWidth: CGFloat = 1.8

    private var stroke: Color { mode.isMonochrome ? .white : color }
    /// A hairline survives being turned into a material badly; give it a
    /// little more to work with once the colour is gone.
    private var width: CGFloat { mode.isMonochrome ? max(lineWidth, 2.2) : lineWidth }

    var body: some View {
        GeometryReader { geo in
            let values = points.map(\.value)
            // A flat run would divide by zero; a hairline down the middle is
            // the honest picture of it.
            let low = values.min() ?? 0
            let high = values.max() ?? 1
            let span = high - low
            // The stroke is centred on the path, so the highest and lowest
            // points need half a line width of room or they draw flat against
            // the edge.
            let inset = width / 2
            let plot = max(geo.size.height - width, 0)

            Path { path in
                guard values.count > 1 else { return }
                for (index, value) in values.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(values.count - 1)
                    let normalised = span > 0 ? (value - low) / span : 0.5
                    let y = inset + plot * (1 - CGFloat(normalised))
                    let point = CGPoint(x: x, y: y)
                    if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                }
            }
            .stroke(stroke, style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
        }
    }
}

struct Stat: View {
    @Environment(\.widgetRenderingMode) private var mode
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                // `.secondary` is a light grey. Vibrant rendering reads that
                // as "nearly as bright as the panel" and the label goes with
                // it, so once the colour is gone the hierarchy comes from
                // opacity and weight instead.
                .font(.system(size: 9, weight: mode.isMonochrome ? .semibold : .medium))
                .foregroundStyle(mode.isMonochrome ? Color.white.opacity(0.78) : Color.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(mode.isMonochrome ? Color.white : Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        // Both labels and values vary in width, so cells claim an equal share
        // of the row rather than each taking what its own text happens to
        // need, which left the columns ragged.
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Caption: View {
    @Environment(\.widgetRenderingMode) private var mode
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: mode.isMonochrome ? .semibold : .medium))
            .foregroundStyle(mode.isMonochrome ? Color.white.opacity(0.78) : Color.secondary)
            .lineLimit(1)
    }
}

struct Unavailable: View {
    @Environment(\.widgetRenderingMode) private var mode
    let message: String

    private var ink: Color {
        mode.isMonochrome ? Color.white.opacity(0.85) : Color.secondary
    }

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 16))
            Text(message)
                .font(.system(size: 10))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(ink)
        .padding(6)
        // Centre the message in the widget instead of leaving it wherever the
        // parent's alignment happens to put it.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
