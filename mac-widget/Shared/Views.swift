import SwiftUI

/// Small pieces the widget and the container app both draw.
///
/// A widget is given a fixed box and clips whatever does not fit, so each of
/// these reports an honest size and keeps its ink inside its own frame.

struct RecoveryRing: View {
    let fraction: Double
    let color: Color
    let label: String
    var lineWidth: CGFloat = 9

    var body: some View {
        ZStack {
            // strokeBorder insets the path by half the line width so the whole
            // stroke lands inside the frame. A plain stroke centres itself on
            // the path and hangs half its width outside, which the widget's
            // own edge then shaves off.
            Circle()
                .strokeBorder(color.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .inset(by: lineWidth / 2)
                .trim(from: 0, to: fraction)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(label)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
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
    let points: [TrendPoint]
    let color: Color
    var lineWidth: CGFloat = 1.8

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
            let inset = lineWidth / 2
            let plot = max(geo.size.height - lineWidth, 0)

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
            .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
    }
}

struct Stat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
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
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

struct Unavailable: View {
    let message: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.system(size: 10))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(6)
        // Centre the message in the widget instead of leaving it wherever the
        // parent's alignment happens to put it.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
