import SwiftUI

/// Small pieces the widget and the container app both draw.

struct RecoveryRing: View {
    let fraction: Double
    let color: Color
    let label: String
    var lineWidth: CGFloat = 9

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(label)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
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

            Path { path in
                guard values.count > 1 else { return }
                for (index, value) in values.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(values.count - 1)
                    let normalised = span > 0 ? (value - low) / span : 0.5
                    let y = geo.size.height * (1 - CGFloat(normalised))
                    let point = CGPoint(x: x, y: y)
                    if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                }
            }
            .stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
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
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
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
    }
}
