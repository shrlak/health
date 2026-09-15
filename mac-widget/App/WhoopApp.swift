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
        .defaultSize(width: 380, height: 470)
    }
}

struct ContentView: View {
    @State private var summary: Summary?
    @State private var failure: String?
    @State private var loading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Whoop")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(GlassPalette.accent)

            if loading {
                ProgressView().frame(maxWidth: .infinity)
            } else if let summary, summary.day != nil {
                loaded(summary)
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
                     + "and drag the size you want into place.")
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
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(GlassBackground())
        .task { await load() }
    }

    @ViewBuilder
    private func loaded(_ summary: Summary) -> some View {
        GlassCard(cornerRadius: 16) {
            HStack(spacing: 18) {
                RecoveryRing(
                    fraction: summary.recoveryFraction,
                    color: summary.recoveryColor,
                    label: summary.recoveryText,
                    lineWidth: 11
                )
                .frame(width: 92, height: 92)

                VStack(alignment: .leading, spacing: 9) {
                    Text(summary.dayText).font(.subheadline).foregroundStyle(.white.opacity(0.7))
                    Text(summary.sleepDetail).font(.caption).foregroundStyle(.white.opacity(0.55))
                    Stat(label: "STRAIN", value: summary.strainText, color: MetricPalette.strain, delta: summary.strainDelta)
                    Stat(label: "SLEEP", value: summary.sleepText, color: MetricPalette.sleep)
                    Stat(label: "HRV", value: summary.hrvText, color: MetricPalette.hrv)
                    Stat(label: "RESTING HR", value: summary.restingHrText, color: MetricPalette.restingHR)
                }
            }
            .padding(14)
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
