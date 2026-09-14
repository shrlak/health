import { useMemo } from 'react'
import { ChartCard, type ChartRow } from '../components/charts/ChartCard'
import { Relationship, SimpleBars, TrendChart } from '../components/charts/Charts'
import { Empty, StatTile } from '../components/ui'
import { hm, num } from '../lib/format'
import { correlate, rolling } from '../lib/analytics'
import { useTheme } from '../lib/theme'
import type { Derived } from './common'
import { recentMean, rowsFrom } from './common'

export function Recovery({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const rows = useMemo(() => {
    const hrvApple = d.metric('hrv_ms')
    const rhrApple = d.metric('resting_hr')
    const spo2 = d.metric('spo2_pct')
    const rr = d.metric('respiratory_rate')

    const base = rowsFrom(d.axis, {
      recovery: (day) => d.recoveries.get(day)?.recovery_pct ?? null,
      // Whoop's chest-strap HRV is the better signal; Apple fills the gaps.
      hrv: (day) => d.recoveries.get(day)?.hrv_ms ?? hrvApple.get(day) ?? null,
      rhr: (day) => d.recoveries.get(day)?.resting_hr ?? rhrApple.get(day) ?? null,
      spo2: (day) => d.recoveries.get(day)?.spo2_pct ?? spo2.get(day) ?? null,
      rr: (day) => d.recoveries.get(day)?.respiratory_rate ?? rr.get(day) ?? null,
      skin: (day) => d.recoveries.get(day)?.skin_temp_c ?? null,
    })

    // A seven-day baseline makes the trend readable through night-to-night noise.
    const hrvRoll = rolling(base.map((r) => ({ day: r.day, value: r.hrv as number | null })), 7)
    const rhrRoll = rolling(base.map((r) => ({ day: r.day, value: r.rhr as number | null })), 7)
    return base.map((r, i): ChartRow => ({
      ...r,
      hrvAvg: hrvRoll[i].value,
      rhrAvg: rhrRoll[i].value,
    }))
  }, [d])

  const sleepVsRecovery = useMemo(() => {
    const pts: Array<{ x: number; y: number; day: string }> = []
    for (const day of d.axis) {
      const asleep = d.sleepByDay.get(day)?.asleep_min
      const rec = d.recoveries.get(day)?.recovery_pct
      if (typeof asleep === 'number' && typeof rec === 'number') {
        pts.push({ x: asleep, y: rec, day })
      }
    }
    return pts
  }, [d])

  const corr = useMemo(() => {
    const a = new Map<string, number>()
    const b = new Map<string, number>()
    for (const p of sleepVsRecovery) { a.set(p.day, p.x); b.set(p.day, p.y) }
    return correlate(a, b)
  }, [sleepVsRecovery])

  const hasAny = rows.some((r) => typeof r.recovery === 'number' || typeof r.hrv === 'number')
  if (!hasAny) {
    return (
      <Empty
        title="No recovery data"
        body="Recovery, HRV and resting heart rate come from Whoop, and HRV also from Apple Watch. Import an export to populate this page."
      />
    )
  }

  const rec30 = recentMean(rows, 'recovery', 30)
  const hrv30 = recentMean(rows, 'hrv', 30)
  const hrv7 = recentMean(rows, 'hrv', 7)
  const rhr30 = recentMean(rows, 'rhr', 30)
  const rhr7 = recentMean(rows, 'rhr', 7)
  const spo230 = recentMean(rows, 'spo2', 30)

  const bandFor = (v: number) =>
    v >= 67 ? palette.good : v >= 34 ? palette.warning : palette.critical

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Recovery, 30-day average"
          value={num(rec30, 0)}
          unit="%"
          color="var(--series-1)"
          sub={rec30 === null ? undefined : rec30 >= 67 ? 'Green zone' : rec30 >= 34 ? 'Yellow zone' : 'Red zone'}
        />
        <StatTile
          label="HRV, 7-day average"
          value={num(hrv7, 0)}
          unit="ms"
          color="var(--series-1)"
          delta={hrv7 !== null && hrv30 !== null ? hrv7 - hrv30 : null}
          deltaLabel="ms vs 30-day"
        />
        <StatTile
          label="Resting HR, 7-day average"
          value={num(rhr7, 0)}
          unit="bpm"
          color="var(--series-1)"
          delta={rhr7 !== null && rhr30 !== null ? rhr7 - rhr30 : null}
          deltaLabel="bpm vs 30-day"
        />
        <StatTile label="Blood oxygen" value={num(spo230, 1)} unit="%" color="var(--series-4)" sub="30-day average" />
      </div>

      <ChartCard
        title="Recovery score"
        accent="var(--series-1)"
        hint="Whoop's daily readiness. Bars are coloured by zone, and the zone thresholds are drawn in."
        rows={rows}
        series={[{ key: 'recovery', label: 'Recovery', color: palette.series[0], format: (v) => `${v.toFixed(0)}%` }]}
      >
        <SimpleBars
          rows={rows}
          series={[{ key: 'recovery', label: 'Recovery', color: palette.series[0], format: (v) => `${v.toFixed(0)}%` }]}
          colorFor={(r) => (typeof r.recovery === 'number' ? bandFor(r.recovery) : palette.grid)}
          yTickFormatter={(v) => `${v}%`}
          guides={[{ value: 67, label: 'Green' }, { value: 34, label: 'Yellow' }]}
          height={220}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Heart rate variability"
          accent="var(--series-1)"
          hint="Nightly value against its seven-day baseline."
          rows={rows}
          series={[
            { key: 'hrv', label: 'Nightly HRV', color: palette.series[0], format: (v) => `${v.toFixed(0)} ms` },
            { key: 'hrvAvg', label: '7-day average', color: palette.series[4], format: (v) => `${v.toFixed(0)} ms` },
          ]}
        >
          <TrendChart
            rows={rows}
            series={[
              { key: 'hrv', label: 'Nightly HRV', color: palette.series[0], format: (v) => `${v.toFixed(0)} ms` },
              { key: 'hrvAvg', label: '7-day average', color: palette.series[4], format: (v) => `${v.toFixed(0)} ms` },
            ]}
            yTickFormatter={(v) => `${v}`}
          />
        </ChartCard>

        <ChartCard
          title="Resting heart rate"
          accent="var(--series-1)"
          hint="Nightly value against its seven-day baseline. A rise usually shows up before you feel run down."
          rows={rows}
          series={[
            { key: 'rhr', label: 'Resting HR', color: palette.series[0], format: (v) => `${v.toFixed(0)} bpm` },
            { key: 'rhrAvg', label: '7-day average', color: palette.series[4], format: (v) => `${v.toFixed(0)} bpm` },
          ]}
        >
          <TrendChart
            rows={rows}
            series={[
              { key: 'rhr', label: 'Resting HR', color: palette.series[0], format: (v) => `${v.toFixed(0)} bpm` },
              { key: 'rhrAvg', label: '7-day average', color: palette.series[4], format: (v) => `${v.toFixed(0)} bpm` },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Respiratory rate and skin temperature"
          accent="var(--series-4)"
          hint="Both drift upward when you are fighting something off."
          rows={rows}
          series={[
            { key: 'rr', label: 'Respiratory rate', color: palette.series[3], format: (v) => `${v.toFixed(1)} rpm` },
            { key: 'skin', label: 'Skin temp', color: palette.series[4], format: (v) => `${v.toFixed(1)} C` },
          ]}
        >
          {/* Two measures on different scales, so they get their own charts
              rather than a second y-axis. */}
          <div className="space-y-2">
            <TrendChart
              rows={rows}
              series={[{ key: 'rr', label: 'Respiratory rate', color: palette.series[3], format: (v) => `${v.toFixed(1)} rpm` }]}
              height={120}
            />
            <TrendChart
              rows={rows}
              series={[{ key: 'skin', label: 'Skin temp', color: palette.series[4], format: (v) => `${v.toFixed(1)} C` }]}
              height={120}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Does more sleep mean better recovery?"
          accent="var(--series-1)"
          hint={
            corr
              ? `Correlation r = ${corr.r.toFixed(2)} across ${corr.n} days. Above about 0.3 is a real pull; near zero means sleep length alone is not what is driving recovery.`
              : 'Needs at least eight days with both sleep and recovery recorded.'
          }
          rows={[]}
          series={[]}
        >
          <Relationship
            points={sleepVsRecovery}
            xLabel="Time asleep"
            yLabel="Recovery %"
            color={palette.series[0]}
            xFormat={(v) => hm(v)}
            yFormat={(v) => `${v.toFixed(0)}%`}
          />
        </ChartCard>
      </div>
    </div>
  )
}
